# Farazhonar Telegram Attendance System — Phase 1 & 2

This repo currently covers **Phase 1** (base infrastructure, database, API skeleton) and **Phase 2** (internal-network IP restriction). Later phases (Telegram bot, Mini App, work-hours engine, reporting, web admin panel) will be added on top of this skeleton as separate prompts/PRs.

## Why these technologies?
- **Node.js + Express**: simple to install and run on Windows, and drops easily into a Windows Service via NSSM (the same approach used for the company's OrderSync project).
- **SQLite (better-sqlite3)**: no separate database service (MySQL/Postgres) to install or maintain on the local server; the whole database is a single file (`data/attendance.db`), and backing it up is just copying that file.

## Setup

```bash
npm install
copy .env.example .env    # Windows; on Linux/Mac: cp .env.example .env
npm run init-db           # create the database file and tables
npm start                 # run the server
```

After starting, `http://localhost:3000/api/health` should respond with `{"status":"ok", ...}`.

## Project structure

```
src/
  config.js               # reads settings from .env
  db/
    schema.js             # full definition of the 6 database tables
    connection.js         # singleton SQLite connection + schema execution
    init.js               # standalone script to create the database
  repositories/           # data-access layer, one file per table
    usersRepository.js
    attendanceRepository.js
    breakRepository.js
    leaveRepository.js
    holidaysRepository.js
    auditRepository.js
  middleware/
    errorHandler.js
    networkRestriction.js # Phase 2: real internal-network IP check
  api/routes/
    health.js
    users.js
    attendance.js
    auditLog.js
    index.js
  server.js               # application entry point
```

## Database tables (per the project spec)

| Table | Description |
|---|---|
| `users` | Employees/managers/admins and the `telegram_user_id` mapping |
| `attendance_records` | Each user's daily check-in/check-out record |
| `break_records` | Lunch/short breaks, linked to a daily attendance record |
| `leave_requests` | Leave and mission (remote work) requests |
| `holidays` | Official holiday calendar |
| `audit_log` | Immutable log of sensitive events |

Important detail baked into the code: every check-in/check-out/break timestamp is taken **from the server clock** (`src/utils/serverTime.js`), never from the client, so it can't be tampered with.

## Current API routes (early skeleton, no real authentication yet)

- `GET /api/health`
- `GET /api/users` and `GET /api/users/:id`
- `POST /api/users` — add an employee
- `PATCH /api/users/:id` — edit
- `DELETE /api/users/:id` — deactivate (soft delete)
- `GET /api/attendance/today?userId=...`
- `POST /api/attendance/check-in` — body: `{ "userId": 1 }`
- `POST /api/attendance/check-out`
- `POST /api/attendance/break/start` — body: `{ "userId": 1, "breakType": "lunch" }`
- `POST /api/attendance/break/end`
- `GET /api/audit-log` and `GET /api/audit-log?userId=...` — view the audit log (no auth yet; will sit behind an admin role in a later phase)

⚠️ Real authentication (roles, manager/admin access on their own routes) isn't in place yet — that's the job of later phases (bot / web panel).

## Phase 2 — Internal network restriction (done)

Routes under `/api/attendance/*` (check-in, check-out, lunch start/end) now go through `src/middleware/networkRestriction.js`:

- The request's source IP is checked against `ALLOWED_NETWORK_CIDR` (default `192.168.10.0/24`).
- If it's outside that range **and** the user doesn't have an approved mission (`leave_requests` with `leave_type='mission'` and `status='approved'`) for that date, the request is rejected with HTTP 403.
- Every rejected attempt (`attendance_rejected_ip`) and every pass via the mission exception (`attendance_allowed_via_mission`) is recorded in `audit_log`, viewable via `GET /api/audit-log`.
- This check is independent of physical network reachability (defense in depth, per the spec): even if a VPN is added later, access stays blocked until its subnet is explicitly added to `ALLOWED_NETWORK_CIDR`.

### ⚠️ A decision that needs your input: `TRUST_PROXY`

The correctness of this check depends entirely on Express resolving the *real* client IP (`req.ip`) correctly. This is a deployment detail **you need to decide based on the final server setup**:

- **If Node.js listens directly on the port**, with no reverse proxy (IIS, nginx, Caddy, etc.) in front of it — which is what the spec currently assumes — leave `TRUST_PROXY=false` (current default) alone. In that case `req.ip` is exactly the employee's real IP on the network.
- **If you later decide to put a reverse proxy on the same local server** (e.g. IIS for SSL certificate handling) in front of this service, you must set `TRUST_PROXY=true`; otherwise Express will always see the proxy's own IP (`127.0.0.1`) instead of the employee's real IP, and requests will either all be rejected or all be (incorrectly) accepted.
- **Security warning**: don't turn on `TRUST_PROXY=true` unless you genuinely have a proxy on that same server — otherwise any outside client could send a forged `X-Forwarded-For: 192.168.10.5` header and bypass the entire Phase 2 network check.

**Decision needed from you:** for getting the SSL certificate and serving the Mini App (Phase 4), will you use a reverse proxy on the local server, or will Node serve HTTPS directly? The answer determines the `TRUST_PROXY` value and should be settled before Phase 4 (where we set up SSL and the subdomain).

## Next step
Phase 3: the Telegram bot in Polling mode (employee/admin commands + scheduled reports and reminders), built on top of this same API and repository layer.
