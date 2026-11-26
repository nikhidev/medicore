# Local verification

Verified 24 November 2026 with synthetic data. See [dashboard screenshot](dashboard.png) and [the walkthrough](../../README.md).

| Check | Result |
| --- | --- |
| Vitest + Supertest with embedded PostgreSQL | 9 passed |
| Same API suite with a disposable native PostgreSQL 16 cluster | 9 passed |
| Playwright with Microsoft Edge | 3 passed, including the sign-in and sign-out boundary |
| FastAPI with pytest | 4 passed |
| Next.js production build and TypeScript | Passed |
| npm audit | 0 known vulnerabilities reported |
| Local administrator report through Next.js, Express, and FastAPI | HTTP 200 with one synthetic age band and 8 appointments |
| OpenAPI route | Served OpenAPI 3.1 JSON |
| Docker Compose, including Redis/BullMQ | Configured and covered by the CI smoke script. Full container run pending on a host with Docker. |

The Python tests pass with one dependency deprecation warning from Starlette's HTTPX test client. The approved local demo uses ports 3080 for web, 4080 for Express and 8000 for FastAPI.
