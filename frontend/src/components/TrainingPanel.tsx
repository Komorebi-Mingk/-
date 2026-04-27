import { useEffect, useMemo, useRef, useState } from "react";
import { FilesetResolver, HandLandmarker } from "@mediapipe/tasks-vision";
import { finishSession, startSession, uploadMetricsWithKeyframes } from "../api";
import type { SessionMetric } from "../types";

type Props = {
  userId: number;
  onFinished: () => Promise<void>;
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

type Landmark = {
  x: number;
  y: number;
  z: number;
};

type CapturedKeyframe = {
  label: string;
  timestamp: string;
  imageDataUrl: string;
  metricValue: number;
};

function pointDistance(a: Landmark, b: Landmark) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

export function TrainingPanel({ userId, onFinished }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const processCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const timerRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const handLandmarkerRef = useRef<HandLandmarker | null>(null);
  const previousGripRef = useRef<number>(0);
  const gripHistoryRef = useRef<number[]>([]);
  const prevFrameRef = useRef<Uint8ClampedArray | null>(null);
  const sampleCountRef = useRef<number>(0);
  const keyframesRef = useRef<Record<string, CapturedKeyframe>>({});

  const [sessionId, setSessionId] = useState<number | null>(null);
  const [metrics, setMetrics] = useState<SessionMetric[]>([]);
  const [running, setRunning] = useState(false);
  const [gripIntensity, setGripIntensity] = useState(0);
  const [detectStatus, setDetectStatus] = useState("等待开始");
  const [usingFallback, setUsingFallback] = useState(false);
  const [handSide, setHandSide] = useState<"left" | "right">("right");
  const [voiceEnabled, setVoiceEnabled] = useState(true);

  const avgGrip = useMemo(() => {
    if (!metrics.length) {
      return 0;
    }
    const total = metrics.reduce((sum, item) => sum + item.gripIntensity, 0);
    return Math.round(total / metrics.length);
  }, [metrics]);

  async function startCamera() {
    streamRef.current = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480 },
      audio: false
    });
    if (videoRef.current) {
      videoRef.current.srcObject = streamRef.current;
      await videoRef.current.play();
    }
  }

  function stopCamera() {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  }

  function stopSampling() {
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    previousGripRef.current = 0;
    gripHistoryRef.current = [];
    prevFrameRef.current = null;
    sampleCountRef.current = 0;
    clearOverlay();
  }

  function captureFrameDataUrl() {
    const video = videoRef.current;
    const canvas = processCanvasRef.current;
    if (!video || !canvas || video.videoWidth === 0 || video.videoHeight === 0) {
      return "";
    }
    canvas.width = 320;
    canvas.height = 240;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return "";
    }
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.72);
  }

  function updateKeyframes(metric: SessionMetric) {
    const frame = captureFrameDataUrl();
    if (!frame) {
      return;
    }

    const current = keyframesRef.current;
    const now = metric.timestamp;
    const grip = current.bestGrip;
    const stability = current.bestStability;
    const fatigue = current.highFatigue;

    if (!grip || metric.gripIntensity > grip.metricValue) {
      current.bestGrip = {
        label: "最佳握力时刻",
        timestamp: now,
        imageDataUrl: frame,
        metricValue: metric.gripIntensity
      };
    }

    if (!stability || metric.stability > stability.metricValue) {
      current.bestStability = {
        label: "最佳稳定度时刻",
        timestamp: now,
        imageDataUrl: frame,
        metricValue: metric.stability
      };
    }

    if (!fatigue || metric.fatigueIndex > fatigue.metricValue) {
      current.highFatigue = {
        label: "高疲劳风险时刻",
        timestamp: now,
        imageDataUrl: frame,
        metricValue: metric.fatigueIndex
      };
    }
  }

  function ensureFallbackKeyframe(currentMetrics: SessionMetric[]) {
    if (Object.keys(keyframesRef.current).length > 0) {
      return;
    }
    const frame = captureFrameDataUrl();
    if (!frame) {
      return;
    }
    const lastMetric = currentMetrics[currentMetrics.length - 1];
    keyframesRef.current.snapshot = {
      label: "训练结束画面",
      timestamp: new Date().toISOString(),
      imageDataUrl: frame,
      metricValue: lastMetric?.gripIntensity ?? 0
    };
  }

  function computeFrameDifference(current: Uint8ClampedArray, prev: Uint8ClampedArray) {
    let sum = 0;
    const len = current.length;
    for (let i = 0; i < len; i += 16) {
      sum += Math.abs(current[i] - prev[i]);
    }
    return sum / (len / 16);
  }

  function clearOverlay() {
    const canvas = overlayCanvasRef.current;
    if (!canvas) {
      return;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  function drawHandLandmarks(landmarks: Landmark[]) {
    const canvas = overlayCanvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) {
      return;
    }

    if (video.videoWidth === 0 || video.videoHeight === 0) {
      return;
    }

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }

    const connections: Array<[number, number]> = [
      [0, 1], [1, 2], [2, 3], [3, 4],
      [0, 5], [5, 6], [6, 7], [7, 8],
      [5, 9], [9, 10], [10, 11], [11, 12],
      [9, 13], [13, 14], [14, 15], [15, 16],
      [13, 17], [17, 18], [18, 19], [19, 20],
      [0, 17]
    ];

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(22, 163, 74, 0.85)";

    for (const [start, end] of connections) {
      const a = landmarks[start];
      const b = landmarks[end];
      ctx.beginPath();
      ctx.moveTo(a.x * canvas.width, a.y * canvas.height);
      ctx.lineTo(b.x * canvas.width, b.y * canvas.height);
      ctx.stroke();
    }

    ctx.fillStyle = "rgba(14, 116, 144, 0.95)";
    for (const point of landmarks) {
      ctx.beginPath();
      ctx.arc(point.x * canvas.width, point.y * canvas.height, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  async function ensureHandLandmarker() {
    if (handLandmarkerRef.current) {
      return handLandmarkerRef.current;
    }

    const vision = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
    );

    handLandmarkerRef.current = await HandLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath:
          "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task"
      },
      runningMode: "VIDEO",
      numHands: 1
    });

    return handLandmarkerRef.current;
  }

  function computeGripByLandmarks(landmarks: Landmark[]) {
    const thumbTip = landmarks[4];
    const indexTip = landmarks[8];
    const middleTip = landmarks[12];
    const indexMcp = landmarks[5];
    const pinkyMcp = landmarks[17];

    const pinchDistance = pointDistance(thumbTip, indexTip);
    const fistDistance = pointDistance(thumbTip, middleTip);
    const palmSpan = Math.max(pointDistance(indexMcp, pinkyMcp), 0.05);

    const closeLevel = 1 - clamp((pinchDistance + fistDistance * 0.5) / (palmSpan * 1.8), 0, 1);
    return Math.round(closeLevel * 100);
  }

  async function startTraining() {
    try {
      await startCamera();
      if (voiceEnabled) {
        speak("训练开始，请选择的手放在画面中央，按节奏进行握紧和放松。", 0);
      }
      let handLandmarker: HandLandmarker | null = null;
      let fallbackMode = false;
      try {
        handLandmarker = await ensureHandLandmarker();
        setUsingFallback(false);
      } catch {
        handLandmarker = null;
        fallbackMode = true;
        setUsingFallback(true);
        setDetectStatus("模型加载失败，已切换基础识别模式");
      }
      const started = await startSession(userId, handSide);
      setSessionId(started.sessionId);
      setMetrics([]);
      keyframesRef.current = {};
      setRunning(true);
      if (!fallbackMode) {
        setDetectStatus("检测中");
      }

      timerRef.current = window.setInterval(() => {
        const video = videoRef.current;
        if (!video || video.readyState < 2) {
          return;
        }

        if (!handLandmarker) {
          const processCanvas = processCanvasRef.current;
          if (!processCanvas) {
            return;
          }
          processCanvas.width = video.videoWidth;
          processCanvas.height = video.videoHeight;
          const ctx = processCanvas.getContext("2d", { willReadFrequently: true });
          if (!ctx) {
            return;
          }
          ctx.drawImage(video, 0, 0, processCanvas.width, processCanvas.height);
          const imageData = ctx.getImageData(0, 0, processCanvas.width, processCanvas.height).data;

          if (!prevFrameRef.current) {
            prevFrameRef.current = new Uint8ClampedArray(imageData);
            return;
          }

          const diff = computeFrameDifference(imageData, prevFrameRef.current);
          prevFrameRef.current = new Uint8ClampedArray(imageData);
          const nextGrip = clamp(Math.round(diff * 2.2), 0, 100);
          const stability = clamp(100 - Math.abs(nextGrip - previousGripRef.current), 0, 100);
          const fatigueIndex = clamp(nextGrip > 75 ? 72 : 38, 0, 100);

          const point: SessionMetric = {
            timestamp: new Date().toISOString(),
            gripIntensity: nextGrip,
            stability,
            fatigueIndex
          };
          previousGripRef.current = nextGrip;
          setGripIntensity(nextGrip);
          setMetrics((prev) => [...prev, point]);
          updateKeyframes(point);
          sampleCountRef.current += 1;
          return;
        }

        const result = handLandmarker.detectForVideo(video, performance.now());
        const firstHand = result.landmarks[0];
        if (!firstHand) {
          setDetectStatus("未检测到手部，请调整位置");
          clearOverlay();
          return;
        }

        setDetectStatus("手部识别稳定");
        const landmarks = firstHand as Landmark[];
        drawHandLandmarks(landmarks);
        const nextGrip = computeGripByLandmarks(landmarks);
        const stability = clamp(100 - Math.abs(nextGrip - previousGripRef.current), 0, 100);

        gripHistoryRef.current = [...gripHistoryRef.current.slice(-19), nextGrip];
        const history = gripHistoryRef.current;
        const drop = history.length > 6 ? history[0] - history[history.length - 1] : 0;
        const fatigueIndex = clamp(35 + Math.max(0, drop) * 0.8 + Math.max(0, 70 - stability) * 0.35, 0, 100);

        const point: SessionMetric = {
          timestamp: new Date().toISOString(),
          gripIntensity: nextGrip,
          stability,
          fatigueIndex
        };
        previousGripRef.current = nextGrip;
        setGripIntensity(nextGrip);
        setMetrics((prev) => [...prev, point]);
        updateKeyframes(point);
        sampleCountRef.current += 1;
        if (voiceEnabled && sampleCountRef.current > 0 && sampleCountRef.current % 15 === 0) {
          speak("保持节奏，缓慢握紧再放松。", 0);
        }
      }, 800);
    } catch {
      setDetectStatus("摄像头或模型初始化失败");
      stopSampling();
      stopCamera();
    }
  }

  async function finishTraining() {
    if (!sessionId) {
      return;
    }
    ensureFallbackKeyframe(metrics);
    stopSampling();
    stopCamera();
    setRunning(false);
    setDetectStatus("训练结束");
    if (voiceEnabled) {
      speak("训练结束，数据上传中。", 0);
    }
    const keyframes = Object.values(keyframesRef.current);
    await uploadMetricsWithKeyframes(sessionId, metrics, keyframes);
    await finishSession(sessionId);
    setSessionId(null);
    await onFinished();
  }

  useEffect(() => {
    return () => {
      window.speechSynthesis.cancel();
      stopSampling();
      stopCamera();
    };
  }, []);

  function speak(text: string, delay: number) {
    if (!voiceEnabled || !("speechSynthesis" in window)) {
      return;
    }
    window.setTimeout(() => {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = "zh-CN";
      utterance.rate = 1;
      window.speechSynthesis.speak(utterance);
    }, delay);
  }

  return (
    <section className="card">
      <h2>摄像头康复训练</h2>
      <p className="muted">请将手掌放在摄像头正前方，做握紧-放松动作。</p>
      <div className="camera-wrap">
        <video ref={videoRef} className="camera" muted playsInline />
        <canvas ref={overlayCanvasRef} className="camera-overlay" />
        <canvas ref={processCanvasRef} className="hidden" />
        <div className="live-indicator">
          <span>{detectStatus}</span>
          <strong>{gripIntensity}</strong>
        </div>
      </div>
      <p className="muted">
        状态：{detectStatus}{usingFallback ? "（当前为基础识别模式）" : "（当前为关键点识别模式）"}
      </p>
      <div className="action-row">
        <div className="option-row">
          <span>训练手别：</span>
          <label>
            <input
              type="radio"
              name="handSide"
              value="left"
              checked={handSide === "left"}
              disabled={running}
              onChange={() => setHandSide("left")}
            />
            左手
          </label>
          <label>
            <input
              type="radio"
              name="handSide"
              value="right"
              checked={handSide === "right"}
              disabled={running}
              onChange={() => setHandSide("right")}
            />
            右手
          </label>
        </div>
        <div className="option-row">
          <label>
            <input
              type="checkbox"
              checked={voiceEnabled}
              onChange={(e) => setVoiceEnabled(e.target.checked)}
            />
            开启语音引导
          </label>
        </div>
        {!running ? (
          <button onClick={startTraining}>开始训练</button>
        ) : (
          <button className="danger" onClick={finishTraining}>
            结束训练
          </button>
        )}
      </div>
      <div className="stats-grid">
        <div>
          <span>采样点</span>
          <strong>{metrics.length}</strong>
        </div>
        <div>
          <span>平均握力指数</span>
          <strong>{avgGrip}</strong>
        </div>
      </div>
    </section>
  );
}
