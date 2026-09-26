# Farazhonar Telegram Attendance System — Phase 1, 2, 3, 4 & 8 (partial)

This repo currently covers **Phase 1** (base infrastructure, database, API skeleton), **Phase 2** (internal-network IP restriction), **Phase 3** (the Telegram bot, in polling mode), **Phase 4** (the Telegram Mini App — employee web UI), and a first slice of **Phase 8** (the web admin panel — auth, employee list, employee profile, add employee). The rest of Phase 8 (leave-request approvals, manual record correction, system settings, audit-trail viewer) plus Phase 5–7 and 9 will be added on top of this skeleton as separate prompts/PRs.

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

## Phase 4 — Telegram Mini App (employee web UI)

A self-contained, no-build-step web app served as static files from the same Node process (`express.static`), so it needs nothing extra in production beyond the subdomain + SSL certificate already covered in the project spec.

```
public/
  index.html      # single page: bottom-nav tabs (Today / History / Report / Leave / Profile)
  css/style.css   # uses Telegram theme CSS variables (--tg-theme-*), light/dark aware
  js/app.js       # vanilla JS, calls Telegram.WebApp SDK + the /api/miniapp/* endpoints below
```

### Real authentication (this was the missing piece flagged in Phase 1/3)

Every `/api/miniapp/*` route now goes through `src/middleware/telegramAuth.js`, which verifies the
Mini App's `initData` string against the official Telegram algorithm
(`src/utils/telegramInitData.js` — HMAC-SHA256 with the bot token, `auth_date` freshness check,
timing-safe comparison). The resolved `req.miniAppUser` (looked up by `telegram_user_id`) is what
every handler uses — **never** a `userId` taken from the request body — so an employee can't act on
someone else's behalf by editing the JS in their browser dev tools. This is a stricter, real version
of the same protection the old `/api/attendance/*` and `/api/users/*` routes still lack (they remain
as an internal skeleton per Phase 1's original scope; give them the same treatment before exposing
them to anything other than the bot/admin panel).

The client sends `initData` (obtained from `Telegram.WebApp.initData`, untouched) in the
`X-Telegram-Init-Data` header on every request — it never parses or trusts it locally.

### New API routes (`src/api/routes/miniapp.js`)

| Route | Notes |
|---|---|
| `GET /api/miniapp/me` | Read-only profile |
| `GET /api/miniapp/today` | Today's record + open break + live summary |
| `POST /api/miniapp/check-in` / `check-out` | Also pass through Phase 2's `networkRestriction` |
| `POST /api/miniapp/break/start` / `break/end` | Same network check |
| `GET /api/miniapp/history?days=30` | Past N days (max 90), each with a `summary` (see `workHours.js`) |
| `GET /api/miniapp/report?period=week\|month` | Aggregate via `workHours.summarizeRange` |
| `POST /api/miniapp/leave`, `GET /api/miniapp/leave` | Submit / list own leave-mission requests |
| `POST /api/miniapp/dispute`, `GET /api/miniapp/dispute` | New — employee can flag a record for admin review without an in-person visit (spec §5, "اعتراض به رکورد") |

`networkRestriction.js` was adjusted so its mission-exception lookup prefers `req.miniAppUser.id`
(the verified identity) over any raw `userId` in the body/query, now that a verified identity is
available on Mini App routes.

### New database table

`record_disputes` (`user_id`, `attendance_record_id` nullable, `message`, `status: open|resolved`) —
backs the dispute feature above. Added to `src/db/schema.js` and has its own repository
(`src/repositories/disputeRepository.js`, including `listOpen()` for the future admin panel).

### Manual test checklist (Phase 4)

1. Fill in `MINI_APP_URL` in `.env` (the real `https://attendance.farazhonar.com/` once DNS/SSL are live) and restart — the bot's menu button will now open it.
2. Open the bot in Telegram, tap the menu button → the page should load and immediately show today's status for the logged-in Telegram account.
3. As an unregistered Telegram account: should see the "not registered" screen with the numeric Telegram ID, matching what `/start` shows in the bot.
4. Tap through Check-in → Start lunch → End lunch → Check-out; confirm the live timer and the today card update after each action.
5. From a network **outside** the allowed CIDR (e.g. mobile data, not company Wi-Fi): check-in should be rejected with the "only from inside the company network" message, and an `attendance_rejected_ip` row should appear in `audit_log`.
6. Switch to History/Report/Leave/Profile tabs; submit a leave request and a dispute; confirm they show up in the lists and (for leave) in `/pending_leaves` on the bot side.

### ⚠️ Known simplification carried over from Phase 3

`workHours.js` is still the lightweight stand-in described in the Phase 3 section — the Mini App's
"Report" tab and history summaries use it too. It will be refined/replaced in Phase 5 per the spec
without needing route or UI changes (same `effectiveMinutes` / `lateMinutes` / etc. shape).

## Next step
Phase 5: the full work-hours calculation engine (overtime rules, holiday-aware math) per the project spec — refining `workHours.js` into the official version used everywhere it's currently a stand-in.

## Phase 8 (partial) — Web admin panel

Served as static files from the same Node process at `/admin/` (e.g. `https://attendance.farazhonar.com/admin/`), same no-build-step philosophy as the Mini App:

```
public-admin/
  index.html      # login screen (Telegram Login Widget) + sidebar app shell
  css/style.css   # a from-scratch dashboard look: sidebar nav, stat cards, table, modal
  js/app.js       # vanilla JS, session-cookie based, calls /api/admin/* below
```

### Login: Telegram Login Widget (not the same mechanism as the Mini App!)

The Mini App (Phase 4) verifies `initData` on every request using the `WebAppData`-keyed HMAC
algorithm. The admin panel is a normal browser page (not inside Telegram), so it uses Telegram's
separate **Login Widget** flow instead — a different verification algorithm
(`src/utils/telegramLoginAuth.js`: `secret_key = SHA256(bot_token)`, not HMAC-keyed). Do not mix
the two up or reuse one verifier for the other's data.

Flow: `public-admin/js/app.js` fetches `GET /api/admin/public-config` for the bot's username (so
the HTML never hardcodes it), injects Telegram's widget script, and on successful Telegram auth
posts the widget's payload to `POST /api/admin/auth/telegram`. The server verifies it, looks the
Telegram ID up in `users`, and — **only if that user's `role` is `manager` or `admin`** — issues a
signed, `HttpOnly` session cookie (`src/utils/session.js`: stateless, HMAC-signed, no session table
needed). All other `/api/admin/*` routes require that cookie (`src/middleware/adminAuth.js`).

⚠️ **`ADMIN_SESSION_SECRET` must be set to a real random value in production** — `createApp()` now
refuses to start in production without one (same philosophy as the existing `TRUST_PROXY` guard).
Generate one with e.g. `openssl rand -hex 32`. You'll also need `TELEGRAM_BOT_USERNAME` set, and the
bot's domain registered with BotFather (`/setdomain`) pointing at the Mini App's HTTPS subdomain,
or the widget will refuse to render.

### Role scoping

- `role: admin` — sees and edits everyone.
- `role: manager` — sees only employees whose `manager_id` is their own `id` (read-only: the
  "Add employee" button is hidden and the profile form is disabled client-side, **and** enforced
  again server-side via `requireFullAdmin` — never rely on the client-side hiding alone).
- `role: employee` — Telegram Login succeeds but the server rejects with 403 (no panel access);
  they only ever use the Mini App / bot.

### New API routes (`src/api/routes/admin.js`, `adminAuth.js`)

| Route | Notes |
|---|---|
| `GET /api/admin/public-config` | Unauthenticated — just the bot username for the login widget |
| `POST /api/admin/auth/telegram` | Verifies the widget payload, sets the session cookie |
| `POST /api/admin/auth/logout` | Clears the cookie |
| `GET /api/admin/me` | Current logged-in admin/manager |
| `GET /api/admin/dashboard` | Counts: active employees, present now, incomplete-today (scoped) |
| `GET /api/admin/users` | Employee list + each one's today status (scoped) |
| `POST /api/admin/users` | Add employee — **admin-only** |
| `GET /api/admin/users/:id` | Full profile + last-30-days summary + recent records (scoped) |
| `PATCH /api/admin/users/:id` | Edit profile — **admin-only** |

`usersRepository.listUsers()` now accepts a `managerId` filter to back the manager-scoping above.

### ⚠️ Not yet re-run end-to-end after this change

Unlike Phase 4 (which was tested live: server boot, real HTTP requests, a simulated valid
`initData`, the full happy path), this Phase 8 slice was **only syntax-checked** (`node --check` on
every new/changed file) — `node_modules` had been removed before packaging the Phase 4 delivery and
this sandbox has no network access to reinstall them this round. The Telegram Login Widget's
verification algorithm was implemented directly from Telegram's documented spec and mirrors the
already-tested `telegramInitData.js` pattern closely, and every repository/util function it calls
already exists and is used elsewhere (`usersRepository`, `attendanceRepository`, `workHours`), but
please run the checklist below yourself after `npm install` and tell me if anything errors — that's
the fastest way for me to fix it.

### Manual test checklist (Phase 8)

1. `npm install`, set `TELEGRAM_BOT_USERNAME` + `ADMIN_SESSION_SECRET` (+ existing `TELEGRAM_BOT_TOKEN`) in `.env`, `npm run init-db`, `npm start`.
2. Register your own Telegram account as a user with `role: admin` (via `/add_employee` in the bot, or directly in the DB for a first bootstrap admin).
3. Open `http://localhost:3000/admin/` (or the real subdomain once live) — should show the login card with a real Telegram login button (needs the bot's domain set via BotFather `/setdomain`, and HTTPS in production — Telegram's widget refuses plain HTTP except on `localhost`).
4. Log in — should land on the dashboard, with your name/role in the sidebar.
5. Go to Employees, click "+ Add employee", submit — new row should appear.
6. Click a row — should open that employee's profile with editable fields and their last-30-days summary/recent records.
7. Create a second user with `role: manager` and a `manager_id` pointing at one employee; log in as them — should see only that one employee, no "Add employee" button, and a disabled (view-only) profile form.
8. Try opening `/admin/` in a private/incognito window without logging in — API calls should 401 and the login card should show, not the dashboard.

## Next step (after Phase 8 is confirmed working)
The rest of Phase 8 (leave-request approval queue, manual record correction with reason logging,
system settings screen, audit-trail viewer) or Phase 5 (full work-hours engine) — whichever you'd
like to continue with once you've tried this out.

## Direct HTTPS (no reverse proxy) — was missing, now implemented

`src/server.js` now creates an `https.createServer()` when `SSL_CERT_PATH` and `SSL_KEY_PATH` are
both set in `.env` (falls back to plain `http.createServer()` otherwise, with a console warning if
that happens in `NODE_ENV=production`). This is what makes the earlier "Node handles TLS itself, no
IIS/nginx" architecture decision actually real in code — until this change, the server only ever
spoke plain HTTP. Point both env vars at the `fullchain`/`privkey` files produced by your DNS-01
issuance for `attendance.farazhonar.com` and restart the service.
