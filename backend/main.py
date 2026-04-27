import json
from datetime import date, datetime, timedelta
from statistics import mean

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from analysis import analyze_metrics
from db import get_conn, init_db, save_session_metrics

app = FastAPI(title="Smart Rehab API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class LoginRequest(BaseModel):
    username: str


class StartSessionRequest(BaseModel):
    userId: int
    handSide: str = "right"


class MetricsUploadRequest(BaseModel):
    metrics: list[dict]
    keyframes: list[dict] = []


def metrics_summary(metrics: list[dict]) -> tuple[float, float, float]:
    if not metrics:
        return 0.0, 0.0, 0.0
    grip_values = [float(m.get("gripIntensity", 0)) for m in metrics]
    stability_values = [float(m.get("stability", 0)) for m in metrics]
    fatigue_values = [float(m.get("fatigueIndex", 0)) for m in metrics]
    return mean(grip_values), mean(stability_values), mean(fatigue_values)


def fatigue_level(avg_fatigue: float) -> str:
    if avg_fatigue > 70:
        return "高"
    if avg_fatigue > 45:
        return "中"
    return "低"


def aggregate_daily_hand_report(conn, target_date: str, hand_side: str) -> dict:
    rows = conn.execute(
        """
        SELECT score, recommendation, metrics_json
        FROM sessions
        WHERE status = 'completed' AND hand_side = ? AND date(started_at) = ?
        ORDER BY finished_at DESC, started_at DESC
        """,
        (hand_side, target_date),
    ).fetchall()

    if not rows:
        return {
            "sessionCount": 0,
            "avgGripIntensity": 0,
            "avgStability": 0,
            "fatigueRisk": "未知",
            "score": 0,
            "recommendation": "今日该手暂无完成训练。",
        }

    score_values: list[float] = []
    grip_values: list[float] = []
    stability_values: list[float] = []
    fatigue_values: list[float] = []

    for row in rows:
        score_values.append(float(row["score"] or 0))
        metrics = json.loads(row["metrics_json"] or "[]")
        avg_grip, avg_stability, avg_fatigue = metrics_summary(metrics)
        grip_values.append(avg_grip)
        stability_values.append(avg_stability)
        fatigue_values.append(avg_fatigue)

    avg_fatigue = mean(fatigue_values) if fatigue_values else 0
    return {
        "sessionCount": len(rows),
        "avgGripIntensity": round(mean(grip_values), 2) if grip_values else 0,
        "avgStability": round(mean(stability_values), 2) if stability_values else 0,
        "fatigueRisk": fatigue_level(avg_fatigue),
        "score": round(mean(score_values)) if score_values else 0,
        "recommendation": rows[0]["recommendation"] or "保持当前训练节奏。",
    }


def session_detail_from_row(row) -> dict:
    metrics = json.loads(row["metrics_json"] or "[]")
    avg_grip, avg_stability, avg_fatigue = metrics_summary(metrics)

    duration_seconds = 0
    if row["started_at"] and row["finished_at"]:
        start = datetime.fromisoformat(row["started_at"])
        finish = datetime.fromisoformat(row["finished_at"])
        duration_seconds = max(0, int((finish - start).total_seconds()))

    return {
        "sessionId": row["id"],
        "handSide": row["hand_side"],
        "status": row["status"],
        "startedAt": row["started_at"],
        "finishedAt": row["finished_at"],
        "durationSeconds": duration_seconds,
        "score": int(row["score"] or 0),
        "avgGripIntensity": round(avg_grip, 2),
        "avgStability": round(avg_stability, 2),
        "fatigueRisk": fatigue_level(avg_fatigue),
        "recommendation": row["recommendation"] or "保持当前训练节奏。",
        "keyframes": json.loads(row["keyframes_json"] or "[]"),
    }


@app.on_event("startup")
def startup_event() -> None:
    init_db()


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok"}


@app.post("/api/auth/login")
def login(payload: LoginRequest) -> dict:
    conn = get_conn()
    row = conn.execute(
        "SELECT id, username, role FROM users WHERE username = ?",
        (payload.username,),
    ).fetchone()
    conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="用户不存在")
    return {
        "token": f"demo-token-{row['id']}",
        "user": {"id": row["id"], "username": row["username"], "role": row["role"]},
    }


@app.get("/api/plans/current")
def current_plan() -> dict:
    conn = get_conn()
    row = conn.execute(
        "SELECT summary, daily_target FROM rehab_plans ORDER BY updated_at DESC LIMIT 1"
    ).fetchone()
    conn.close()
    if not row:
        return {"planSummary": "暂无训练计划", "dailyTarget": 1}
    return {"planSummary": row["summary"], "dailyTarget": row["daily_target"]}


@app.post("/api/sessions/start")
def start_session(payload: StartSessionRequest) -> dict:
    hand_side = payload.handSide if payload.handSide in {"left", "right"} else "right"
    conn = get_conn()
    cur = conn.cursor()
    cur.execute(
        "INSERT INTO sessions (user_id, hand_side, status, started_at) VALUES (?, ?, ?, ?)",
        (payload.userId, hand_side, "in_progress", datetime.utcnow().isoformat()),
    )
    conn.commit()
    session_id = cur.lastrowid
    conn.close()
    return {"sessionId": session_id}


@app.post("/api/sessions/{session_id}/metrics")
def upload_session_metrics(session_id: int, payload: MetricsUploadRequest) -> dict:
    save_session_metrics(session_id, payload.metrics, payload.keyframes)
    return {"saved": True, "count": len(payload.metrics)}


@app.post("/api/sessions/{session_id}/finish")
def finish_session(session_id: int) -> dict:
    conn = get_conn()
    row = conn.execute(
        "SELECT user_id, metrics_json FROM sessions WHERE id = ?",
        (session_id,),
    ).fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="训练不存在")

    metrics = json.loads(row["metrics_json"])
    session_status = "completed" if len(metrics) >= 3 else "interrupted"
    result = analyze_metrics(metrics)
    now = datetime.utcnow().isoformat()
    report_date = datetime.utcnow().date().isoformat()

    conn.execute(
        "UPDATE sessions SET finished_at = ?, score = ?, recommendation = ?, status = ? WHERE id = ?",
        (now, result["score"], result["recommendation"], session_status, session_id),
    )

    if session_status != "completed":
        conn.commit()
        conn.close()
        return {
            **result,
            "status": "interrupted",
            "message": "训练时长偏短，已记录为未完成训练。",
        }

    existing = conn.execute(
        "SELECT id, session_count FROM daily_reports WHERE user_id = ? AND report_date = ?",
        (row["user_id"], report_date),
    ).fetchone()

    if existing:
        conn.execute(
            """
            UPDATE daily_reports
            SET
              session_count = ?,
              avg_grip_intensity = ?,
              avg_stability = ?,
              fatigue_risk = ?,
              score = ?,
              recommendation = ?
            WHERE id = ?
            """,
            (
                existing["session_count"] + 1,
                result["avg_grip_intensity"],
                result["avg_stability"],
                result["fatigue_risk"],
                result["score"],
                result["recommendation"],
                existing["id"],
            ),
        )
    else:
        conn.execute(
            """
            INSERT INTO daily_reports (
              user_id, report_date, session_count, avg_grip_intensity,
              avg_stability, fatigue_risk, score, recommendation
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                row["user_id"],
                report_date,
                1,
                result["avg_grip_intensity"],
                result["avg_stability"],
                result["fatigue_risk"],
                result["score"],
                result["recommendation"],
            ),
        )

    conn.commit()
    conn.close()
    return {**result, "status": "completed"}


@app.get("/api/reports/daily")
def get_daily_report() -> dict:
    conn = get_conn()
    row = conn.execute(
        """
        SELECT report_date, session_count, avg_grip_intensity,
               avg_stability, fatigue_risk, score, recommendation
        FROM daily_reports
        ORDER BY report_date DESC
        LIMIT 1
        """
    ).fetchone()
    conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="暂无日报")
    return {
        "reportDate": row["report_date"],
        "sessionCount": row["session_count"],
        "avgGripIntensity": row["avg_grip_intensity"],
        "avgStability": row["avg_stability"],
        "fatigueRisk": row["fatigue_risk"],
        "score": row["score"],
        "recommendation": row["recommendation"],
    }


@app.get("/api/reports/daily-by-hand")
def get_daily_report_by_hand(target_date: str | None = None) -> dict:
    report_date = target_date or date.today().isoformat()
    conn = get_conn()
    left = aggregate_daily_hand_report(conn, report_date, "left")
    right = aggregate_daily_hand_report(conn, report_date, "right")
    conn.close()

    return {
        "reportDate": report_date,
        "left": left,
        "right": right,
        "comparison": {
            "scoreDiff": left["score"] - right["score"],
            "gripDiff": round(left["avgGripIntensity"] - right["avgGripIntensity"], 2),
            "stabilityDiff": round(left["avgStability"] - right["avgStability"], 2),
        },
    }


@app.get("/api/reports/trend")
def get_trend(days: int = 7, handSide: str = "all") -> list[dict]:
    hand_side = handSide if handSide in {"all", "left", "right"} else "all"
    window = max(1, min(days, 60))
    start_date = date.today() - timedelta(days=window - 1)

    conn = get_conn()
    rows = conn.execute(
        """
        SELECT date(started_at) AS day, score, metrics_json
        FROM sessions
        WHERE status = 'completed' AND date(started_at) >= ?
          AND (? = 'all' OR hand_side = ?)
        ORDER BY day ASC
        """,
        (start_date.isoformat(), hand_side, hand_side),
    ).fetchall()
    conn.close()

    grouped: dict[str, dict[str, list[float]]] = {}
    for row in rows:
        day = row["day"]
        if day not in grouped:
            grouped[day] = {"scores": [], "grips": []}

        grouped[day]["scores"].append(float(row["score"] or 0))
        metrics = json.loads(row["metrics_json"] or "[]")
        avg_grip, _, _ = metrics_summary(metrics)
        grouped[day]["grips"].append(avg_grip)

    result = []
    for day in sorted(grouped.keys()):
        scores = grouped[day]["scores"]
        grips = grouped[day]["grips"]
        result.append(
            {
                "reportDate": day,
                "score": round(mean(scores)) if scores else 0,
                "avgGripIntensity": round(mean(grips), 2) if grips else 0,
            }
        )

    return result


@app.get("/api/recommendations/latest")
def latest_recommendation() -> dict:
    conn = get_conn()
    row = conn.execute(
        "SELECT recommendation FROM daily_reports ORDER BY report_date DESC LIMIT 1"
    ).fetchone()
    conn.close()
    if not row:
        return {"recommendation": "暂无建议"}
    return {"recommendation": row["recommendation"]}


@app.get("/api/calendar")
def get_training_calendar(days: int = 14) -> list[dict]:
    window = max(1, min(days, 60))
    start_date = date.today() - timedelta(days=window - 1)
    conn = get_conn()
    rows = conn.execute(
        """
        SELECT date(started_at) AS day,
               COUNT(*) AS total_count,
               SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed_count,
               SUM(CASE WHEN status = 'interrupted' THEN 1 ELSE 0 END) AS interrupted_count,
               SUM(CASE WHEN hand_side = 'left' THEN 1 ELSE 0 END) AS left_count,
               SUM(CASE WHEN hand_side = 'right' THEN 1 ELSE 0 END) AS right_count
        FROM sessions
        WHERE date(started_at) >= ?
        GROUP BY date(started_at)
        """,
        (start_date.isoformat(),),
    ).fetchall()
    conn.close()

    by_day = {r["day"]: r for r in rows}
    result: list[dict] = []
    for offset in range(window):
        day = start_date + timedelta(days=offset)
        day_str = day.isoformat()
        row = by_day.get(day_str)
        total = int(row["total_count"]) if row else 0
        completed = int(row["completed_count"]) if row else 0
        interrupted = int(row["interrupted_count"]) if row else 0

        if completed > 0:
            status = "completed"
        elif total > 0 or interrupted > 0:
            status = "interrupted"
        elif day == date.today():
            status = "pending"
        else:
            status = "missed"

        result.append(
            {
                "date": day_str,
                "status": status,
                "totalSessions": total,
                "completedSessions": completed,
                "leftSessions": int(row["left_count"]) if row else 0,
                "rightSessions": int(row["right_count"]) if row else 0,
            }
        )

    return result


@app.get("/api/calendar/day-detail")
def get_calendar_day_detail(targetDate: str) -> dict:
    try:
        parsed_date = date.fromisoformat(targetDate)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="日期格式错误，应为 YYYY-MM-DD") from exc

    conn = get_conn()
    rows = conn.execute(
        """
        SELECT id, hand_side, status, started_at, finished_at, score, recommendation, metrics_json, keyframes_json
        FROM sessions
        WHERE date(started_at) = ?
        ORDER BY started_at DESC
        """,
        (parsed_date.isoformat(),),
    ).fetchall()
    conn.close()

    details = [session_detail_from_row(row) for row in rows]
    left_sessions = [item for item in details if item["handSide"] == "left"]
    right_sessions = [item for item in details if item["handSide"] == "right"]

    return {
        "date": parsed_date.isoformat(),
        "summary": {
            "totalSessions": len(details),
            "completedSessions": sum(1 for item in details if item["status"] == "completed"),
            "interruptedSessions": sum(1 for item in details if item["status"] == "interrupted"),
            "leftSessions": len(left_sessions),
            "rightSessions": len(right_sessions),
        },
        "leftSessions": left_sessions,
        "rightSessions": right_sessions,
    }


@app.get("/api/alerts/reminders")
def get_reminders() -> dict:
    alerts: list[dict] = []
    conn = get_conn()

    calendar_rows = conn.execute(
        """
        SELECT date(started_at) AS day,
               SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed_count,
               SUM(CASE WHEN status = 'interrupted' THEN 1 ELSE 0 END) AS interrupted_count
        FROM sessions
        WHERE date(started_at) >= date('now', '-7 days')
        GROUP BY date(started_at)
        ORDER BY day DESC
        """
    ).fetchall()

    reports = conn.execute(
        """
        SELECT report_date, score
        FROM daily_reports
        ORDER BY report_date DESC
        LIMIT 3
        """
    ).fetchall()

    completed_days = [int(r["completed_count"] or 0) for r in calendar_rows[:3]]
    if completed_days and sum(1 for c in completed_days if c == 0) >= 2:
        alerts.append(
            {
                "type": "adherence",
                "level": "warning",
                "message": "最近 3 天内有 2 天未完成训练，请尽量保持每日练习。",
            }
        )

    interrupted_count = sum(int(r["interrupted_count"] or 0) for r in calendar_rows[:3])
    if interrupted_count >= 2:
        alerts.append(
            {
                "type": "interrupted",
                "level": "warning",
                "message": "近期中断训练次数偏多，建议缩短单次时长并分多次完成。",
            }
        )

    if len(reports) == 3:
        score_series = [int(r["score"]) for r in reports]
        if score_series[0] < score_series[1] < score_series[2]:
            alerts.append(
                {
                    "type": "decline",
                    "level": "high",
                    "message": "康复评分连续下降，建议联系康复师评估训练方案。",
                }
            )

    imbalance_rows = conn.execute(
        """
        SELECT date(started_at) AS day, hand_side, AVG(score) AS avg_score
        FROM sessions
        WHERE status = 'completed' AND date(started_at) >= date('now', '-10 days')
        GROUP BY date(started_at), hand_side
        ORDER BY day DESC
        """
    ).fetchall()
    conn.close()

    by_day: dict[str, dict[str, float]] = {}
    for row in imbalance_rows:
        if row["day"] not in by_day:
            by_day[row["day"]] = {}
        by_day[row["day"]][row["hand_side"]] = float(row["avg_score"] or 0)

    diffs: list[float] = []
    for day in sorted(by_day.keys(), reverse=True):
        item = by_day[day]
        if "left" in item and "right" in item:
            diffs.append(abs(item["left"] - item["right"]))
        if len(diffs) == 3:
            break

    if len(diffs) == 3 and diffs[2] < diffs[1] < diffs[0] and diffs[0] - diffs[2] >= 8:
        alerts.append(
            {
                "type": "hand_imbalance",
                "level": "high" if diffs[0] >= 15 else "warning",
                "message": "左右手差值已连续 3 天扩大，建议联系康复师调整训练配比。",
                "meta": {
                    "diffSeries": [round(diffs[2], 2), round(diffs[1], 2), round(diffs[0], 2)],
                    "threshold": 8,
                },
            }
        )

    if not alerts:
        alerts.append(
            {
                "type": "stable",
                "level": "info",
                "message": "当前训练节奏稳定，请继续保持。",
            }
        )

    return {"alerts": alerts}
