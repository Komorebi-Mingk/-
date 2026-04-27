import json
import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).parent / "rehab.db"


def get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    conn = get_conn()
    cur = conn.cursor()
    cur.executescript(
        """
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            role TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS rehab_plans (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            summary TEXT NOT NULL,
            daily_target INTEGER NOT NULL DEFAULT 2,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users(id)
        );

        CREATE TABLE IF NOT EXISTS sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            hand_side TEXT NOT NULL DEFAULT 'right',
            status TEXT NOT NULL DEFAULT 'in_progress',
            started_at TEXT NOT NULL,
            finished_at TEXT,
            metrics_json TEXT DEFAULT '[]',
            keyframes_json TEXT DEFAULT '[]',
            score INTEGER,
            recommendation TEXT,
            FOREIGN KEY (user_id) REFERENCES users(id)
        );

        CREATE TABLE IF NOT EXISTS daily_reports (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            report_date TEXT NOT NULL,
            session_count INTEGER NOT NULL,
            avg_grip_intensity REAL NOT NULL,
            avg_stability REAL NOT NULL,
            fatigue_risk TEXT NOT NULL,
            score INTEGER NOT NULL,
            recommendation TEXT NOT NULL,
            UNIQUE (user_id, report_date),
            FOREIGN KEY (user_id) REFERENCES users(id)
        );
        """
    )
    conn.commit()

    def ensure_column(table: str, column: str, ddl: str) -> None:
        rows = conn.execute(f"PRAGMA table_info({table})").fetchall()
        exists = any(r["name"] == column for r in rows)
        if not exists:
            conn.execute(f"ALTER TABLE {table} ADD COLUMN {ddl}")

    ensure_column("rehab_plans", "daily_target", "daily_target INTEGER NOT NULL DEFAULT 2")
    ensure_column("sessions", "hand_side", "hand_side TEXT NOT NULL DEFAULT 'right'")
    ensure_column("sessions", "status", "status TEXT NOT NULL DEFAULT 'in_progress'")
    ensure_column("sessions", "keyframes_json", "keyframes_json TEXT DEFAULT '[]'")
    conn.commit()

    cur.execute("SELECT id FROM users WHERE username = ?", ("patient-demo",))
    user = cur.fetchone()
    if not user:
        cur.execute(
            "INSERT INTO users (username, role) VALUES (?, ?)",
            ("patient-demo", "patient"),
        )
        user_id = cur.lastrowid
        cur.execute(
            "INSERT INTO rehab_plans (user_id, summary, daily_target, updated_at) VALUES (?, ?, ?, datetime('now'))",
            (user_id, "每日 2 组握紧-放松训练，每组 8 分钟，组间休息 3 分钟", 2),
        )
        conn.commit()

    conn.close()


def save_session_metrics(session_id: int, metrics: list[dict], keyframes: list[dict] | None = None) -> None:
    conn = get_conn()
    keyframes_payload = keyframes or []
    conn.execute(
        "UPDATE sessions SET metrics_json = ?, keyframes_json = ? WHERE id = ?",
        (
            json.dumps(metrics, ensure_ascii=False),
            json.dumps(keyframes_payload, ensure_ascii=False),
            session_id,
        ),
    )
    conn.commit()
    conn.close()
