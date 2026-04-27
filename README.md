# 智慧养老康复项目（医疗康复方向）

本项目实现了一个可运行的 MVP：通过摄像头采集手部康复动作数据，上传至后端进行分析，并在网页端展示每日报告和趋势建议。

## 项目结构

- `frontend/`：React + Vite + TypeScript 网页端
- `backend/`：FastAPI 后端服务，提供训练数据上传与分析 API

## 功能清单

- 摄像头采集训练动作（MediaPipe 手部关键点识别）
- 语音引导训练（开始、过程提醒、结束提示）
- 训练前选择左手或右手，支持每天多次训练
- 每次训练完成后上传数据并生成分析结果
- 每日康复评分按左手/右手分别展示，并提供左右手差值
- 训练任务日历（近 14 天完成/中断/未完成状态）
- 支持点击日历日期查看当天多次训练明细（按左右手分组）
- 支持点击单次训练记录回看关键帧（最佳握力/最佳稳定度/高疲劳时刻）
- 支持关键帧放大预览与左右滑动切换，并可导出单次训练摘要图
- 异常提醒（连续未完成、评分下降、中断偏多）
- 新增左右手差值连续 3 天扩大的异常提醒
- 近 7 天趋势图支持全部/左手/右手切换

## 快速启动

### 启动后端

```bash
cd backend
pip install --break-system-packages -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

### 启动前端

```bash
cd frontend
npm install
npm run dev -- --host 0.0.0.0 --port 5173
```

## 下载与测试

### 从 GitHub 下载

```bash
git clone https://github.com/Komorebi-Mingk/-.git
cd -
git checkout 260413-feat-smart-elderly-rehab-web
```

### 本地联调测试

1. 按“快速启动”分别启动后端和前端。
2. 打开 `http://localhost:5173`。
3. 点击“进入患者训练端”后开始一次训练。
4. 结束训练后查看：
   - 每日分析（左手/右手）
   - 日历明细与关键帧回看
   - 异常提醒

### 在线预览（当前开发环境）

- 前端预览：`https://5173-2436f0aa0f24941c.monkeycode-ai.online`
- 后端健康检查：`https://8000-2436f0aa0f24941c.monkeycode-ai.online/api/health`

## API 概览

- `POST /api/auth/login`
- `GET /api/plans/current`
- `POST /api/sessions/start`
- `POST /api/sessions/{id}/metrics`
- `POST /api/sessions/{id}/finish`
- `GET /api/reports/daily-by-hand`
- `GET /api/reports/trend?days=7&handSide=all|left|right`
- `GET /api/calendar?days=14`
- `GET /api/calendar/day-detail?targetDate=YYYY-MM-DD`
- `GET /api/alerts/reminders`
- `GET /api/reports/daily`
- `GET /api/reports/trend?days=7`
- `GET /api/recommendations/latest`

## 说明

- 当前版本重点是网页和代码架构，分析逻辑采用规则引擎（可扩展为模型推理）。
- 摄像头指标属于动作趋势评估，不等同医疗器械级绝对握力值。
