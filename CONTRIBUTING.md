# Contributing Guide

Thanks for your interest in improving this project.

## Development Setup

### 1) Clone repository

```bash
git clone https://github.com/Komorebi-Mingk/-.git
cd -
```

### 2) Start backend

```bash
cd backend
pip3 install --break-system-packages -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

### 3) Start frontend

```bash
cd frontend
npm install
npm run dev -- --host 0.0.0.0 --port 5173
```

## Contribution Flow

1. Create a feature branch from `main`.
2. Keep changes focused and small.
3. Run quick checks before pushing:

```bash
# Backend syntax check
python3 -m py_compile backend/main.py backend/db.py backend/analysis.py

# Frontend build check
cd frontend
npm run build
```

4. Commit with clear messages (for example: `feat: add xxx`, `fix: resolve xxx`, `docs: update xxx`).
5. Push branch and open a pull request.

## Pull Request Checklist

- Feature works on both desktop and mobile.
- Frontend and backend both start correctly.
- No secrets or private credentials are committed.
- README is updated if behavior or setup changed.

## Reporting Issues

When opening an issue, please include:

- What you expected
- What happened
- Repro steps
- Screenshots or logs (if available)
