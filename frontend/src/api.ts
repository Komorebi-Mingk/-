import axios from "axios";
import type {
  AlertItem,
  CalendarDayDetail,
  CalendarItem,
  DailyByHandReport,
  DailyReport,
  SessionMetric,
  TrendReport
} from "./types";

const client = axios.create({
  baseURL: "/api"
});

export async function login(username: string) {
  const { data } = await client.post("/auth/login", { username });
  return data;
}

export async function getCurrentPlan() {
  const { data } = await client.get("/plans/current");
  return data;
}

export async function startSession(userId: number, handSide: "left" | "right") {
  const { data } = await client.post("/sessions/start", { userId, handSide });
  return data;
}

export async function uploadMetrics(sessionId: number, metrics: SessionMetric[]) {
  const { data } = await client.post(`/sessions/${sessionId}/metrics`, { metrics });
  return data;
}

export async function uploadMetricsWithKeyframes(
  sessionId: number,
  metrics: SessionMetric[],
  keyframes: Array<{ label: string; timestamp: string; imageDataUrl: string; metricValue: number }>
) {
  const { data } = await client.post(`/sessions/${sessionId}/metrics`, { metrics, keyframes });
  return data;
}

export async function finishSession(sessionId: number) {
  const { data } = await client.post(`/sessions/${sessionId}/finish`);
  return data;
}

export async function getDailyReport() {
  const { data } = await client.get<DailyReport>("/reports/daily");
  return data;
}

export async function getDailyReportByHand() {
  const { data } = await client.get<DailyByHandReport>("/reports/daily-by-hand");
  return data;
}

export async function getTrendReport(days = 7, handSide: "all" | "left" | "right" = "all") {
  const { data } = await client.get<TrendReport[]>("/reports/trend", {
    params: { days, handSide }
  });
  return data;
}

export async function getLatestRecommendation() {
  const { data } = await client.get("/recommendations/latest");
  return data;
}

export async function getCalendar(days = 14) {
  const { data } = await client.get<CalendarItem[]>("/calendar", { params: { days } });
  return data;
}

export async function getCalendarDayDetail(targetDate: string) {
  const { data } = await client.get<CalendarDayDetail>("/calendar/day-detail", {
    params: { targetDate }
  });
  return data;
}

export async function getReminders() {
  const { data } = await client.get<{ alerts: AlertItem[] }>("/alerts/reminders");
  return data;
}
