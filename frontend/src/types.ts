export type SessionMetric = {
  timestamp: string;
  gripIntensity: number;
  stability: number;
  fatigueIndex: number;
};

export type DailyReport = {
  reportDate: string;
  sessionCount: number;
  avgGripIntensity: number;
  avgStability: number;
  fatigueRisk: string;
  score: number;
  recommendation: string;
};

export type HandDailyReport = {
  sessionCount: number;
  avgGripIntensity: number;
  avgStability: number;
  fatigueRisk: string;
  score: number;
  recommendation: string;
};

export type DailyByHandReport = {
  reportDate: string;
  left: HandDailyReport;
  right: HandDailyReport;
  comparison: {
    scoreDiff: number;
    gripDiff: number;
    stabilityDiff: number;
  };
};

export type TrendReport = {
  reportDate: string;
  score: number;
  avgGripIntensity: number;
};

export type CalendarItem = {
  date: string;
  status: "completed" | "interrupted" | "missed" | "pending";
  totalSessions: number;
  completedSessions: number;
  leftSessions: number;
  rightSessions: number;
};

export type SessionDetail = {
  sessionId: number;
  handSide: "left" | "right";
  status: "completed" | "interrupted" | "in_progress";
  startedAt: string;
  finishedAt: string | null;
  durationSeconds: number;
  score: number;
  avgGripIntensity: number;
  avgStability: number;
  fatigueRisk: string;
  recommendation: string;
  keyframes: SessionKeyframe[];
};

export type SessionKeyframe = {
  label: string;
  timestamp: string;
  imageDataUrl: string;
  metricValue: number;
};

export type CalendarDayDetail = {
  date: string;
  summary: {
    totalSessions: number;
    completedSessions: number;
    interruptedSessions: number;
    leftSessions: number;
    rightSessions: number;
  };
  leftSessions: SessionDetail[];
  rightSessions: SessionDetail[];
};

export type AlertItem = {
  type: string;
  level: "info" | "warning" | "high";
  message: string;
  meta?: {
    diffSeries?: number[];
    threshold?: number;
  };
};
