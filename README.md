# Callzo Engineering Assessment

Software Engineer Intern take-home. Each task is self-contained and has its own README.

| Task | Folder | Run it |
|---|---|---|
| 1. Usage metering service (FastAPI, Postgres) | [`task1-usage-metering/`](task1-usage-metering/README.md) | `cd task1-usage-metering && docker compose up --build` |
| 2. Usage admin console (React, Tailwind, Recharts) | [`task2-admin-console/`](task2-admin-console/README.md) | `cd task2-admin-console && docker compose up` |

Both need Docker only. The two provided images are published for `linux/arm64` alone,
so the compose files pin that platform: it runs natively on Apple Silicon and under
Docker Desktop's emulation on x86, where the first start is slower.
