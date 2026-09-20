# Farazhonar Telegram Attendance System — Phase 1, 2 & 3

This repo currently covers **Phase 1** (base infrastructure, database, API skeleton), **Phase 2** (internal-network IP restriction), and **Phase 3** (the Telegram bot, in polling mode). Later phases (Mini App, the full work-hours calculation engine, richer reporting, the web admin panel) will be added on top of this skeleton as separate prompts/PRs.

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

## Phase 3 — Telegram bot (Polling mode)

The bot lives in `src/bot/` and runs in the same process as the API server via `src/index.js` (the new `npm start` entry point). It uses **long polling**, not a webhook, so no inbound port needs to be opened on the company router — it only needs outbound internet access to reach `api.telegram.org`.

```
src/bot/
  index.js               # bot bootstrap: command routing, message/callback dispatch, menu button
  auth.js                 # maps a Telegram sender to a row in `users` + role check
  session.js               # in-memory state for multi-step conversations (/leave, /add_employee, /fix_record)
  commands/
    start.js, help.js, status.js, report.js, leave.js
    addEmployee.js, listEmployees.js, teamReport.js, pendingLeaves.js, fixRecord.js
  scheduler/
    index.js               # registers all node-cron jobs
    lateCheckinReminder.js, checkoutReminder.js, autoCloseIncomplete.js, reports.js
src/scripts/createAdmin.js  # one-off script to bootstrap the very first admin
src/utils/workHours.js      # lightweight late/early/effective-hours math used by the bot's reports
                             # (a preliminary stand-in for the full Phase 5 calculation engine)
src/utils/jalali.js         # Jalali (Persian) calendar helpers — monthly reports/summaries use the
                             # Jalali month, not the Gregorian one
```

### Getting a bot token

1. In Telegram, open a chat with **@BotFather**.
2. Send `/newbot` and follow the prompts (choose a name and a username ending in `bot`).
3. BotFather replies with a token like `123456789:AAExample-Token`. Put it in `.env` as `TELEGRAM_BOT_TOKEN`.

### Bootstrapping the first admin (do this once)

`/add_employee` can only be run by an existing admin — but the database starts with zero users, so there's a chicken-and-egg problem. Solve it once with:

```bash
# 1. Message your bot on Telegram (e.g. send /start). It will reply with your numeric Telegram ID
#    because you aren't registered yet.
# 2. Create yourself as the first admin:
npm run create-admin -- <your_telegram_id> "Your Full Name"
# 3. Send /start to the bot again — you're now recognized as admin.
```

### Employee commands

| Command | Description |
|---|---|
| `/start` | Welcome message; shows your numeric Telegram ID if you aren't registered yet |
| `/status` | Live status: present / on lunch-or-break / out of office |
| `/report` | Personal summary for the current week and month (effective hours, lateness, early leaves) |
| `/leave` | Multi-step flow to submit a leave or mission (remote-work) request |
| `/help` | Role-aware command list |

### Manager / admin commands (based on `role` in the `users` table)

| Command | Who | Description |
|---|---|---|
| `/add_employee` | admin only | Multi-step flow: Telegram ID → name → personnel code → department → role → manager |
| `/list_employees` | manager (own team) / admin (everyone) | List with status |
| `/team_report` | manager (own team) / admin (everyone) | 7-day summary per employee |
| `/pending_leaves` | manager (own team) / admin (everyone) | Each pending request gets inline **Approve/Reject** buttons |
| `/fix_record` | admin only | Multi-step manual correction of `check_in_time` / `check_out_time` / `status`, with a **mandatory reason**, logged to `audit_log` |

The bot only responds to operational commands for users present in the `users` table (mapped by `telegram_user_id`); anyone else gets "you are not registered in the system."

### Scheduled jobs (`node-cron`, see `src/bot/scheduler/`)

- Late check-in reminder (per employee, once per day, after `WORK_DAY_START` + a grace period)
- Checkout reminder (per employee, shortly before `WORK_DAY_END`)
- Repeated-lateness alert to the direct manager (threshold configurable via `REPEATED_LATENESS_THRESHOLD`)
- End-of-day report to every manager/admin (their own team's status)
- Weekly report (start of the work week)
- Monthly report (**Jalali/Persian calendar month** — runs daily internally, only actually sends on the first day of a new Jalali month, covering the just-finished Jalali month)
- End-of-day auto-close: any record with a check-in but no check-out is marked `incomplete` for an admin to review

All the cron expressions and thresholds above are configurable in `.env` (`CRON_*`, `WORK_DAY_START`, `WORK_DAY_END`, `LATE_CHECKIN_GRACE_MINUTES`, `CHECKOUT_REMINDER_MINUTES_BEFORE`, `REPEATED_LATENESS_THRESHOLD`). **The shipped defaults assume a Saturday–Wednesday work week — double-check and adjust them for the company's actual working days before deploying.**

### ⚠️ Known simplifications in this phase (flagged for your decision)

- **Late/early/effective-hours math** used by `/report`, `/team_report`, and the scheduled reports lives in `src/utils/workHours.js`. It's a lightweight stand-in so the bot has something real to report on; the full calculation engine (overtime rules, holiday handling in the math, etc.) is Phase 5 per the spec and will likely refine or replace this file.
- **Menu Button / Mini App**: the code will set a `web_app` menu button only if `MINI_APP_URL` is filled in `.env`. Leave it empty until Phase 4 builds the real Mini App page.
- **Conversation state** (`/leave`, `/add_employee`, `/fix_record`) is kept in memory, not the database — if the bot process restarts mid-conversation, the user just needs to re-run the command. This was a reasonable simplification for Phase 3; say so if you'd rather it survive restarts.

### Manual test checklist (per the spec)

1. `/start` as a brand-new Telegram account → should say "you are not registered" and show your ID.
2. `npm run create-admin -- <id> "Name"` → `/start` again → should greet you normally.
3. `/add_employee` → walk through the flow to register a second (employee) account.
4. From the employee account: `/status`, then `/leave` → submit a leave request.
5. From the admin account: `/pending_leaves` → tap Approve → confirm the employee gets a Telegram notification.

### Running it

```bash
npm install
npm run init-db
npm start          # runs src/index.js: API server + bot together
```

If you only want the HTTP API without the bot (e.g. while testing), use `npm run start:api-only`.

## Next step
Phase 4: the Telegram Mini App (employee web UI), served over HTTPS from the same local server, using the subdomain + DNS-01 certificate described in the project spec.
