import { useEffect, useState } from "react";
import {
  getCalendar,
  getCalendarDayDetail,
  getCurrentPlan,
  getDailyReportByHand,
  getLatestRecommendation,
  getReminders,
  getTrendReport,
  login
} from "./api";
import { TrendChart } from "./components/TrendChart";
import { TrainingPanel } from "./components/TrainingPanel";
import type {
  AlertItem,
  CalendarDayDetail,
  CalendarItem,
  DailyByHandReport,
  HandDailyReport,
  SessionDetail,
  TrendReport
} from "./types";

type User = {
  id: number;
  username: string;
  role: string;
};

export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [dailyReportByHand, setDailyReportByHand] = useState<DailyByHandReport | null>(null);
  const [trendData, setTrendData] = useState<TrendReport[]>([]);
  const [recommendation, setRecommendation] = useState<string>("暂无建议");
  const [plan, setPlan] = useState<string>("加载中...");
  const [dailyTarget, setDailyTarget] = useState<number>(1);
  const [calendar, setCalendar] = useState<CalendarItem[]>([]);
  const [reminders, setReminders] = useState<AlertItem[]>([]);
  const [trendFilter, setTrendFilter] = useState<"all" | "left" | "right">("all");
  const [selectedDate, setSelectedDate] = useState<string>("");
  const [dayDetail, setDayDetail] = useState<CalendarDayDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [expandedSessionId, setExpandedSessionId] = useState<number | null>(null);
  const [previewSession, setPreviewSession] = useState<SessionDetail | null>(null);
  const [previewFrameIndex, setPreviewFrameIndex] = useState(0);
  const [touchStartX, setTouchStartX] = useState<number | null>(null);

  async function loadDashboard() {
    try {
      const [reportByHand, trend, rec, currentPlan, calendarRows, reminderResult] = await Promise.all([
        getDailyReportByHand(),
        getTrendReport(7, trendFilter),
        getLatestRecommendation(),
        getCurrentPlan(),
        getCalendar(14),
        getReminders()
      ]);
      setDailyReportByHand(reportByHand);
      setTrendData(trend);
      setRecommendation(rec.recommendation ?? "暂无建议");
      setPlan(currentPlan.planSummary ?? "暂无训练计划");
      setDailyTarget(currentPlan.dailyTarget ?? 1);
      setCalendar(calendarRows);
      setReminders(reminderResult.alerts ?? []);
    } catch {
      setPlan("暂无训练计划");
    }
  }

  async function loadDayDetail(targetDate: string) {
    setSelectedDate(targetDate);
    setDetailLoading(true);
    setExpandedSessionId(null);
    try {
      const detail = await getCalendarDayDetail(targetDate);
      setDayDetail(detail);
    } catch {
      setDayDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }

  function statusText(status: CalendarItem["status"]) {
    if (status === "completed") {
      return "已完成";
    }
    if (status === "interrupted") {
      return "中断";
    }
    if (status === "pending") {
      return "待训练";
    }
    return "未完成";
  }

  useEffect(() => {
    if (!user) {
      return;
    }
    void loadDashboard();
  }, [user, trendFilter]);

  function renderHandPanel(title: string, report: HandDailyReport) {
    return (
      <div className="hand-panel">
        <h3>{title}</h3>
        <div className="stats-grid">
          <div>
            <span>训练次数</span>
            <strong>{report.sessionCount}</strong>
          </div>
          <div>
            <span>康复评分</span>
            <strong>{report.score}</strong>
          </div>
          <div>
            <span>平均握力指数</span>
            <strong>{report.avgGripIntensity}</strong>
          </div>
          <div>
            <span>平均稳定度</span>
            <strong>{report.avgStability}</strong>
          </div>
          <div>
            <span>疲劳风险</span>
            <strong>{report.fatigueRisk}</strong>
          </div>
          <div>
            <span>手别建议</span>
            <strong>{report.recommendation}</strong>
          </div>
        </div>
      </div>
    );
  }

  function formatDuration(seconds: number) {
    if (!seconds) {
      return "0分";
    }
    const minutes = Math.floor(seconds / 60);
    const remainSeconds = seconds % 60;
    return `${minutes}分${remainSeconds}秒`;
  }

  function formatTime(iso: string) {
    const time = new Date(iso);
    return `${String(time.getHours()).padStart(2, "0")}:${String(time.getMinutes()).padStart(2, "0")}`;
  }

  function statusLabel(status: SessionDetail["status"]) {
    if (status === "completed") {
      return "完成";
    }
    if (status === "interrupted") {
      return "中断";
    }
    return "进行中";
  }

  function openPreview(session: SessionDetail, index: number) {
    setPreviewSession(session);
    setPreviewFrameIndex(index);
  }

  function closePreview() {
    setPreviewSession(null);
    setPreviewFrameIndex(0);
    setTouchStartX(null);
  }

  function movePreview(step: number) {
    if (!previewSession || previewSession.keyframes.length === 0) {
      return;
    }
    const maxIndex = previewSession.keyframes.length - 1;
    setPreviewFrameIndex((prev) => {
      const next = prev + step;
      if (next < 0) {
        return 0;
      }
      if (next > maxIndex) {
        return maxIndex;
      }
      return next;
    });
  }

  function onPreviewTouchStart(clientX: number) {
    setTouchStartX(clientX);
  }

  function onPreviewTouchEnd(clientX: number) {
    if (touchStartX === null) {
      return;
    }
    const delta = clientX - touchStartX;
    if (delta > 40) {
      movePreview(-1);
    } else if (delta < -40) {
      movePreview(1);
    }
    setTouchStartX(null);
  }

  async function loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("image load failed"));
      img.src = src;
    });
  }

  async function exportSessionSummary(session: SessionDetail) {
    const canvas = document.createElement("canvas");
    canvas.width = 1000;
    canvas.height = 700;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }

    ctx.fillStyle = "#f8fafc";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#0f172a";
    ctx.font = "bold 38px sans-serif";
    ctx.fillText("康复训练摘要", 42, 62);

    ctx.font = "26px sans-serif";
    ctx.fillStyle = "#334155";
    ctx.fillText(`日期：${selectedDate}`, 42, 110);
    ctx.fillText(`手别：${session.handSide === "left" ? "左手" : "右手"}`, 42, 148);
    ctx.fillText(`状态：${statusLabel(session.status)}`, 42, 186);
    ctx.fillText(`时长：${formatDuration(session.durationSeconds)}`, 42, 224);

    ctx.fillStyle = "#0f172a";
    ctx.font = "24px sans-serif";
    ctx.fillText(`评分 ${session.score}`, 42, 280);
    ctx.fillText(`握力 ${session.avgGripIntensity}`, 220, 280);
    ctx.fillText(`稳定度 ${session.avgStability}`, 398, 280);
    ctx.fillText(`疲劳 ${session.fatigueRisk}`, 620, 280);

    const frames = session.keyframes.slice(0, 3);
    const baseY = 320;
    const imageW = 280;
    const imageH = 200;
    const gap = 30;

    for (let i = 0; i < frames.length; i += 1) {
      const frame = frames[i];
      const x = 42 + i * (imageW + gap);
      try {
        const img = await loadImage(frame.imageDataUrl);
        ctx.drawImage(img, x, baseY, imageW, imageH);
      } catch {
        ctx.fillStyle = "#e2e8f0";
        ctx.fillRect(x, baseY, imageW, imageH);
      }
      ctx.fillStyle = "#0f172a";
      ctx.font = "20px sans-serif";
      ctx.fillText(frame.label, x, baseY + imageH + 30);
      ctx.fillStyle = "#475569";
      ctx.font = "18px sans-serif";
      ctx.fillText(`指标 ${frame.metricValue}  ${formatTime(frame.timestamp)}`, x, baseY + imageH + 56);
    }

    ctx.fillStyle = "#475569";
    ctx.font = "18px sans-serif";
    ctx.fillText(`建议：${session.recommendation}`, 42, 664);

    const link = document.createElement("a");
    link.href = canvas.toDataURL("image/png");
    link.download = `rehab-summary-${selectedDate}-session-${session.sessionId}.png`;
    link.click();
  }

  function renderSessionList(title: string, sessions: SessionDetail[]) {
    return (
      <div className="session-group">
        <h4>{title}</h4>
        {sessions.length === 0 ? (
          <p className="muted">暂无记录</p>
        ) : (
          sessions.map((session) => (
            <div className="session-item" key={session.sessionId}>
              <div className="session-row">
                <strong>
                  {formatTime(session.startedAt)} - {session.finishedAt ? formatTime(session.finishedAt) : "进行中"}
                </strong>
                <span className={`status-tag status-${session.status}`}>
                  {statusLabel(session.status)}
                </span>
              </div>
              <small>
                时长 {formatDuration(session.durationSeconds)} / 评分 {session.score} / 握力 {session.avgGripIntensity} /
                稳定度 {session.avgStability} / 疲劳 {session.fatigueRisk}
              </small>
              {session.keyframes.length > 0 ? (
                <>
                  <button
                    className="session-detail-btn"
                    onClick={() =>
                      setExpandedSessionId((prev) => (prev === session.sessionId ? null : session.sessionId))
                    }
                  >
                    {expandedSessionId === session.sessionId ? "收起关键帧" : "回看关键帧"}
                  </button>
                  {expandedSessionId === session.sessionId ? (
                    <div className="keyframe-grid">
                      {session.keyframes.map((frame, index) => (
                        <div className="keyframe-item" key={`${session.sessionId}-${frame.label}`}>
                          <button
                            className="keyframe-preview-btn"
                            onClick={() => openPreview(session, index)}
                            title="点击放大并左右切换"
                          >
                            <img alt={frame.label} src={frame.imageDataUrl} />
                          </button>
                          <small>
                            {frame.label}（{formatTime(frame.timestamp)} / 指标 {frame.metricValue}）
                          </small>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  <button className="session-detail-btn" onClick={() => void exportSessionSummary(session)}>
                    导出训练摘要图
                  </button>
                </>
              ) : (
                <small>无关键帧记录</small>
              )}
            </div>
          ))
        )}
      </div>
    );
  }

  async function handleLogin() {
    const result = await login("patient-demo");
    setUser(result.user);
  }

  if (!user) {
    return (
      <main className="login-page">
        <section className="login-card">
          <h1>智慧养老康复平台</h1>
          <p>面向手握力康复训练的数据采集与分析系统</p>
          <button onClick={handleLogin}>进入患者训练端</button>
        </section>
      </main>
    );
  }

  return (
    <main className="dashboard">
      <header className="hero">
        <h1>欢迎，{user.username}</h1>
        <p>今日计划：{plan}（目标 {dailyTarget} 次/天）</p>
      </header>
      <section className="grid">
        <TrainingPanel userId={user.id} onFinished={loadDashboard} />
        <article className="card">
          <h2>每日分析（左右手）</h2>
          {dailyReportByHand ? (
            <>
              <div className="hand-panel-grid">
                {renderHandPanel("左手", dailyReportByHand.left)}
                {renderHandPanel("右手", dailyReportByHand.right)}
              </div>
              <div className="comparison-row">
                <span>左右手差值（左 - 右）</span>
                <strong>评分 {dailyReportByHand.comparison.scoreDiff}</strong>
                <strong>握力 {dailyReportByHand.comparison.gripDiff}</strong>
                <strong>稳定度 {dailyReportByHand.comparison.stabilityDiff}</strong>
              </div>
              <p className="muted">综合建议：{recommendation}</p>
            </>
          ) : (
            <p className="muted">今天还没有训练数据，完成左右手训练后即可查看分手分析。</p>
          )}
        </article>
      </section>
      <section className="card">
        <div className="trend-header">
          <h2>近 7 天康复趋势</h2>
          <div className="trend-filter">
            <button
              className={trendFilter === "all" ? "active" : ""}
              onClick={() => setTrendFilter("all")}
            >
              全部
            </button>
            <button
              className={trendFilter === "left" ? "active" : ""}
              onClick={() => setTrendFilter("left")}
            >
              左手
            </button>
            <button
              className={trendFilter === "right" ? "active" : ""}
              onClick={() => setTrendFilter("right")}
            >
              右手
            </button>
          </div>
        </div>
        <TrendChart data={trendData} />
      </section>
      <section className="grid">
        <article className="card">
          <h2>训练任务日历（近 14 天）</h2>
          <div className="calendar-grid">
            {calendar.map((item) => (
              <div className={`calendar-item status-${item.status}`} key={item.date}>
                <strong>{item.date.slice(5)}</strong>
                <span>{statusText(item.status)}</span>
                <small>
                  总{item.totalSessions} / 成{item.completedSessions} / 左{item.leftSessions} / 右{item.rightSessions}
                </small>
                <button className="calendar-detail-btn" onClick={() => loadDayDetail(item.date)}>
                  查看明细
                </button>
              </div>
            ))}
          </div>
          {selectedDate ? (
            <div className="day-detail-panel">
              <h3>当日训练明细：{selectedDate}</h3>
              {detailLoading ? (
                <p className="muted">正在加载明细...</p>
              ) : dayDetail ? (
                <>
                  <div className="comparison-row">
                    <strong>总次数 {dayDetail.summary.totalSessions}</strong>
                    <strong>完成 {dayDetail.summary.completedSessions}</strong>
                    <strong>中断 {dayDetail.summary.interruptedSessions}</strong>
                    <strong>左手 {dayDetail.summary.leftSessions}</strong>
                    <strong>右手 {dayDetail.summary.rightSessions}</strong>
                  </div>
                  <div className="session-group-grid">
                    {renderSessionList("左手", dayDetail.leftSessions)}
                    {renderSessionList("右手", dayDetail.rightSessions)}
                  </div>
                </>
              ) : (
                <p className="muted">当天暂无训练明细。</p>
              )}
            </div>
          ) : null}
        </article>
        <article className="card">
          <h2>异常提醒</h2>
          <ul className="reminder-list">
            {reminders.map((alert) => (
              <li key={`${alert.type}-${alert.message}`} className={`alert-${alert.level}`}>
                <strong>[{alert.type}]</strong> {alert.message}
                {alert.type === "hand_imbalance" && alert.meta?.diffSeries ? (
                  <small>
                    差值趋势：{alert.meta.diffSeries.join(" -> ")}（阈值 {alert.meta.threshold ?? 8}）
                  </small>
                ) : null}
              </li>
            ))}
          </ul>
        </article>
      </section>
      {previewSession && previewSession.keyframes[previewFrameIndex] ? (
        <div className="preview-mask" onClick={closePreview}>
          <div className="preview-modal" onClick={(e) => e.stopPropagation()}>
            <div className="preview-top">
              <strong>
                {previewSession.handSide === "left" ? "左手" : "右手"} - {previewSession.keyframes[previewFrameIndex].label}
              </strong>
              <button className="session-detail-btn" onClick={closePreview}>
                关闭
              </button>
            </div>
            <div
              className="preview-image-wrap"
              onTouchStart={(e) => onPreviewTouchStart(e.touches[0].clientX)}
              onTouchEnd={(e) => onPreviewTouchEnd(e.changedTouches[0].clientX)}
            >
              <img
                className="preview-image"
                src={previewSession.keyframes[previewFrameIndex].imageDataUrl}
                alt={previewSession.keyframes[previewFrameIndex].label}
              />
            </div>
            <div className="preview-controls">
              <button onClick={() => movePreview(-1)} disabled={previewFrameIndex === 0}>
                上一张
              </button>
              <span>
                {previewFrameIndex + 1} / {previewSession.keyframes.length}
              </span>
              <button
                onClick={() => movePreview(1)}
                disabled={previewFrameIndex >= previewSession.keyframes.length - 1}
              >
                下一张
              </button>
            </div>
            <p className="muted preview-tip">支持左右滑动切换关键帧（移动端）</p>
          </div>
        </div>
      ) : null}
    </main>
  );
}
