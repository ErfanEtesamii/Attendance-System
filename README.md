# Farahonar Telegram Attendance System

Employee check-in / check-out / break tracking through a **Telegram bot** and a **Telegram Mini App**, with useful-working-hours calculation, leave / mission / remote work, weekly plans and daily task reports, periodic reports, and a **web admin panel**. On-site attendance can only be recorded from inside the company network (outside the network only with an approved mission or approved remote work).

> Note: the bot, Mini App and admin panel UI are in Persian (Farsi), and `docs/DOCUMENTATION.md` is also written in Persian. Section names and UI labels quoted below are translated into English.

## Table of Contents

- [Documentation](#documentation)
- [Features](#features)
- [Tech Stack](#tech-stack)
- [Installation and Running](#installation-and-running)
- [Environment Variables](#environment-variables)
- [Database and Migrations](#database-and-migrations)
- [Folder Structure](#folder-structure)
- [Roles and Permissions](#roles-and-permissions)
- [Authentication](#authentication)
- [Network Restriction and Remote Work](#network-restriction-and-remote-work)
- [API Routes](#api-routes)
- [Telegram Bot and Jobs](#telegram-bot-and-jobs)
- [Security and Monitoring](#security-and-monitoring)
- [Deployment (Windows + NSSM)](#deployment-windows--nssm)
- [Backup and Restore](#backup-and-restore)
- [Testing](#testing)
- [Current Status and Open Items](#current-status-and-open-items)

## Documentation

| File | Contents |
|---|---|
| [`docs/DOCUMENTATION.md`](docs/DOCUMENTATION.md) | **Unified technical documentation**: architecture, security / secrets / monitoring / suspicious events, UI states, decisions and deployment / manual-test checklists for every phase (10 to 19), the PDF decision, and the manual test of the daily-report wizard. Has a clickable table of contents at the top. |
| [`PROJECT_STATUS.md`](PROJECT_STATUS.md) | Phase status, file map, remaining work, and the complete `.env` reference |
| [`CHANGELOG.md`](CHANGELOG.md) | Change history |
| [`BACKUP_RESTORE.md`](BACKUP_RESTORE.md) | Database backup and restore |
| [`.env.example`](.env.example) | Sample configuration with an explanation of every value |

> The `docs/` folder used to contain several dozen separate files (`PHASE*_DECISIONS.md`, `PHASE*_DEPLOY.md`, `SECURITY.md`, …); all of them have been merged into `docs/DOCUMENTATION.md`. References to the old file names (for example in `CHANGELOG.md`) can be found in the merged file, next to the title of each section.

## Features

**Attendance and working hours**
- Check-in, check-out, break, and **re-entry** on the same day (multiple presence segments, capped by `maxReEntriesPerDay`; segments are summed in the calculation engine and in reports)
- Lunch rule: automatic deduction of `fixedLunchDeductMinutes=45` for presence of at least `fixedLunchMinPresenceMinutes=240`; if lunch is recorded, only its actual duration is deducted
- Paid breaks: a shared daily pool (`paidBreakCount=3`, `paidBreakMinutes=45`); anything beyond it is unpaid
- Shifts with an "effective date", rotating shifts, and day-by-day schedule overrides per employee
- Lateness limit and "check-in permission" (requested by the employee, approved by the supervisor / admin)
- Useful-hours calculation engine, overtime with approval, marking of holidays / leave days, automatic closing of incomplete records

**Leave, mission, remote work**
- Leave types with balances, an approval chain (supervisor → HR), substitute, attachments, and a bulk approval queue
- Missions (create, "right now", cancel, nightly confirmation) which grant the network exception
- **Off-network remote work** (phase 14): separate sessions and breaks, supervisor approval, counted separately in reports (setting `remoteWorkEnabled`)

**Weekly plan and tasks**
- Next-week plan written by the employee, with a priority-based check-out gate and a lock once the week starts (`PLAN_LOCKED`)
- Daily task report (done / partial / not done, note, task carry-over and undo), the "My Day" page, and the weekly board
- Urgent tasks (assigned by a supervisor/admin or created personally) with deadline reminders; a mandatory "review yesterday's report" task for supervisors
- Admins/supervisors can edit employees' next-week plans in a "notebook"-style UI, with concurrency control (`PLAN_CONFLICT`)
- Nightly task report for supervisors/admins and task KPIs

**Reports, analytics and control**
- Daily / weekly / monthly reports (Jalali calendar), CSV export (and `.xlsx` if `exceljs` is installed), print view
- Analytics: lateness trend and comparison, rankings, attendance rate, check-in distribution, patterns; calendar; leave balances
- Month closing (checklist, adjustments, reopening), suspicious events (anti-fraud: same IP, device change), a non-editable Audit Log with archiving
- Record disputes with a two-way conversation (messages, reopening up to `disputeMaxReopens`, closing)

**Interfaces**
- **Employee Mini App** (`public/`): navy/orange palette, "Today" progress ring, Jalali history grid, SVG charts, Telegram WebApp integration (BackButton, Haptic, safe-area, Telegram theme)
- **Admin panel** (`public-admin/`): dashboard, "My Status" for all four roles, grouped settings page, responsive tables, bottom-sheet, command palette (`Ctrl/Cmd+K`), accessible charts, light/dark theme
- **Telegram bot**: role-based "📂 Menu" (the only keyboard button)

**Administration and operations**
- Application reset (double confirmation, backup, Go-Live lock), broadcast messages, daily backup, Audit archive, database maintenance
- A watchdog that sends Telegram alerts to admins (disk, polling, Jobs, backup) and records Job runs

## Tech Stack

Node.js (>=18) · Express 4 · SQLite (`better-sqlite3`) · `node-telegram-bot-api` (polling) · `node-cron` · `jalaali-js` · `exceljs` (optional, for `.xlsx`).
The front end (Mini App and panel) uses plain JavaScript with no build step.
SQLite means no separate database service; the whole database is a single file (`data/attendance.db`). It runs on a local Windows server using NSSM.

## Installation and Running

```bash
npm install
copy .env.example .env      # Windows (Linux/macOS: cp .env.example .env), then fill in the values
npm run migrate             # create/update the database (or npm run init-db for an empty database)
npm run create-admin -- <telegram_id> "Full Name"   # only once: the first admin
npm start                   # API + bot in one process
```

- API only, without the bot: `npm run start:api-only`
- Development with automatic restart: `npm run dev`
- Health check: `GET /api/health` → `{"status":"ok", ...}`

### First admin
The database starts with no users. Send a message to the bot (`/start`); it tells you your numeric Telegram ID. Then run `npm run create-admin -- <id> "Name"` and send `/start` again.

### npm scripts

| Command | Purpose |
|---|---|
| `npm start` / `npm run dev` / `npm run start:api-only` | Run (normal / with watch / API only) |
| `npm run init-db` / `npm run migrate` / `npm run migrate:status` | Database |
| `npm run create-admin -- <id> "Name"` | Create the first admin |
| `npm test` / `npm run test:watch` | Tests |
| `npm run smoke` | Smoke test against a real server and a temporary database |
| `npm run bench:analytics` | Analytics benchmark |
| `npm run secret-scan` | Search the project for secrets (exit code 1 = findings) |
| `npm run package` | Build a delivery zip without secrets in `dist/` |

Other helper scripts: `src/scripts/seedEmployees.js`, `src/scripts/pushPanelButton.js` (replaces the old bot keyboard; `--apply`), `scripts/restore-backup.js`, `scripts/install-fonts.js`.

## Environment Variables

The full reference is in [`PROJECT_STATUS.md`](PROJECT_STATUS.md) (section 7), and each value is explained inside `.env.example`. The most important ones:

| Variable | Description |
|---|---|
| `TELEGRAM_BOT_TOKEN` | Bot token from BotFather |
| `TELEGRAM_BOT_USERNAME` | Bot username without `@` (used for panel login) |
| `ADMIN_SESSION_SECRET` | **Required in production**; a long random string (`openssl rand -hex 32`) |
| `ADMIN_SESSION_MAX_AGE_DAYS` | Panel session lifetime |
| `MINI_APP_URL` | Final Mini App URL, e.g. `https://attendance.farazhonar.com/` |
| `PORT` / `NODE_ENV` | Port and run mode (`production` for deployment) |
| `SSL_CERT_PATH` / `SSL_KEY_PATH` | HTTPS certificate; empty = plain HTTP (development only) |
| `ALLOWED_NETWORK_CIDR` | Network range allowed to record attendance (default `192.168.10.0/24`) |
| `TRUST_PROXY` | Must stay `false` (there is no proxy) |
| `DB_PATH` | Database file path (default `./data/attendance.db`) |
| `TIMEZONE`, `WORK_DAY_START`, `WORK_DAY_END` | Time zone and default working hours |
| `LATE_CHECKIN_GRACE_MINUTES`, `CHECKOUT_REMINDER_MINUTES_BEFORE`, `REPEATED_LATENESS_THRESHOLD` | Lateness and reminder thresholds |
| `CRON_*` | Job schedules (reports, reminders, nightly review, backup, archive, watchdog, …) |
| `ALLOW_DATA_RESET` | Allows the application reset (deliberately keep it off in production) |
| `CSP_MODE` | `report-only` (default) / `enforce` / `off` |
| `ADMIN_COOKIE_SAMESITE` | `strict` (default) or `lax` as an emergency fallback |
| `RATE_LIMIT_STORE` | `sqlite` (default, persistent) or `memory` |
| `WATCHDOG_ENABLED` / `ALERT_THROTTLE_MINUTES` / `MONITOR_*` | Monitoring and Telegram alerts |
| `CRON_DAILY_BACKUP` / `BACKUP_KEEP_DAILY` / `BACKUP_KEEP_MONTHLY` | Automatic backup and retention |
| `FRAUD_*` | Thresholds for suspicious-event detection |
| `CSP_PANEL_UNSAFE_EVAL` / `HSTS_MAX_AGE_SECONDS` / `CSRF_EXTRA_ORIGINS` | Advanced web security settings |

> ⚠️ Never commit `.env`, the `.ssl/` folder, or `data/*.db` files, and never put them in a delivery zip. Use `npm run package` to build the delivery package (it strips secrets automatically), and run `npm run secret-scan` before committing/sending. In production the server will not start if `ADMIN_SESSION_SECRET` is shorter than 32 characters or is a sample value. For the "if a secret leaks" checklist, see the "Secret management" section in [`docs/DOCUMENTATION.md`](docs/DOCUMENTATION.md).

Most business rules (lunch, breaks, lateness limit, remote work, plan/report gates, …) live in the `settings` table and are changed from the panel's "Settings" page (or `GET/PATCH /api/admin/settings`), not from `.env`.

## Database and Migrations

Database schema changes are made **only** through migrations (`src/db/migrations/`, numbered files; currently `001` to `042`):

```bash
npm run migrate           # apply pending migrations (takes a backup first)
npm run migrate:status    # show status only
```

- Each migration runs inside a single transaction and is fully rolled back on error.
- Before running, a WAL-safe backup is taken at `data/backups/pre-migration-<timestamp>.db` (the last few copies are kept).
- The server automatically applies pending migrations at startup.
- On production, it is better to stop the service before running `npm run migrate` manually (`nssm stop <service>`).
- To change a `CHECK` constraint in SQLite, a table-rebuild helper (`rebuildTable`) is available in `src/db/migrator.js`.

Main table groups: users and roles (`users`), attendance (`attendance_records`, `attendance_segments`, `break_records`), leave (`leave_requests`, `leave_types`, `leave_balances`, approvals and attachments), holidays and month closing, disputes (`record_disputes` and messages), shifts and the day-by-day schedule, weekly plans and tasks (`weekly_plans`, urgent tasks, task log), remote work (sessions and breaks), check-in permission, notifications, suspicious events, `settings`, `rate_limits`, `job_runs`, `audit_log` (non-editable) and `schema_migrations`.
All attendance times are taken from the **server clock**, not the client.

## Folder Structure

```
src/
  index.js                 entry point: API + bot (this is what NSSM runs)
  server.js                builds the Express app + HTTPS/HTTP
  config.js                reads .env (not read when NODE_ENV=test)
  db/                      connection, migrator, migrate.js, init.js, migrations/
  repositories/            the only layer that writes SQL
  services/                business logic (leave, mission, remote work, weekly plan, tasks, reports,
                           analytics, month closing, reset, notifications, …)
  engine/                  working-day calculation engine (computeDay, dayService, calendarService)
  middleware/              adminAuth, telegramAuth, networkRestriction, rateLimiter, csrf, permissions,
                           securityHeaders, maintenanceGate, errorHandler
  api/routes/
    index.js               mounts all routes under /api
    health.js  miniapp.js  adminAuth.js  cspReport.js
    admin/                 admin panel, split by domain (one file per area)
  bot/                     bot, commands/, menu (menu/), button pickers (ui/), cron Jobs (scheduler/), notifier
  content/                 static texts (encouragement messages, report labels)
  utils/                   workHours, jalali, csv, session, serverTime, telegramInitData, telegramLoginAuth,
                           fraudDetection, jobRunner, backupRetention ...
  scripts/                 createAdmin, seedEmployees, pushPanelButton
public/                    employee Mini App (no build): app.js, planner.js, dailyReport.js, css/tokens.css (shared theme tokens)
public-admin/              web admin panel (no build), under /admin/; views in js/views-*.js
                           "notebook" design system: css/notebook.css + js/notebook.js; demo page /admin/nb-demo.html
                           (static data, no API; removable)
scripts/                   install-service.ps1 (NSSM), setup-ssl-renewal.ps1, run-tests.js, smoke-test.js,
                           package-release.js, secret-scan.js, restore-backup.js, bench-analytics.js, lib/
deploy/                    .bat files to install/restart/remove the service
test/                      automated tests (node:test)
docs/                      DOCUMENTATION.md (unified technical documentation)
data/                      database, backups/, attachments/ (not committed)
```


## Roles and Permissions

| Role | Access |
|---|---|
| `admin` | Everything; settings, Audit, record correction, broadcast, backup, reset, month closing |
| `hr` (human resources) | Global read access (users, reports, analytics, leave balances, closed months), the "HR" step in the leave approval chain; no admin management powers |
| `manager` ("supervisor") | Only their own team (`manager_id`); view, approve leave / remote work / check-in permission, handle disputes, weekly plan and urgent tasks of subordinates, message the team |
| `employee` | Only their own data, and only the whitelisted routes in `EMPLOYEE_ALLOWED` in `src/middleware/adminAuth.js`; any new route is closed to them by default (default-deny) |

Permissions are defined as "area.action" (such as `leave.approve`, `schedule.manage`, `plan.edit_team`) in `src/middleware/permissions.js`, and roles are mapped to them. The supervisor's team scope is enforced server-side (`src/api/routes/admin/common.js`); hiding buttons in the UI is not security. The bot also checks the role from the database every time.

## Authentication

Two separate algorithms — never substitute one for the other:

| Entry | Algorithm | File |
|---|---|---|
| Mini App | `initData` — `HMAC_SHA256(key="WebAppData")` | `src/utils/telegramInitData.js` |
| Panel login | Login Widget — `secret = SHA256(botToken)` | `src/utils/telegramLoginAuth.js` |

After login, the panel receives a signed `HttpOnly` cookie (stateless) (`src/utils/session.js`). Login with a one-time code from the bot, and via the direct panel-button link, is also available. Sessions can be revoked, and state-changing requests are protected by CSRF (details in [`docs/DOCUMENTATION.md`](docs/DOCUMENTATION.md), web security section).

## Network Restriction and Remote Work

`src/middleware/networkRestriction.js` is applied to `check-in`, `re-check-in`, `check-out` and `break/*` in the Mini App: the source IP must be inside `ALLOWED_NETWORK_CIDR`, or the user must have an **approved mission** for that same day. For this exception, the user's identity is read only from `req.miniAppUser` (signed). Every rejection and every pass through the exception is recorded in `audit_log`.

If `remoteWorkEnabled` is on, an employee outside the network (`OUT_OF_NETWORK`) can start a **remote work** session (`/api/miniapp/remote/*`); once approved by the supervisor, these sessions are counted in reports with a separate counter and label.

## API Routes

All routes are under `/api`. The list below is a grouped summary; the exact reference is the files `src/api/routes/miniapp.js` and `src/api/routes/admin/*.js` and the role × route test matrix. The old phase-1 routes (`/api/users*`, `/api/attendance/*`, `/api/audit-log`) were removed in `1.0.0-rc.1`.

### Public
| Route | Description |
|---|---|
| `GET /health` | Service health: only `status` (`ok`/`degraded`) and `time` |
| `POST /csp-report` | Receives CSP reports |

### Employee Mini App (`/miniapp/*`, behind `telegramAuth`)
| Route | Description |
|---|---|
| `GET me`, `today`, `history`, `report`, `network-state` | Employee data and network state |
| `POST check-in`, `re-check-in`, `check-out`, `break/start`, `break/end` | Record attendance (+ network + rate limit); a late check-in with the lateness limit in `enforce` mode ⇒ 409 `LATE_LIMIT_REACHED` |
| `GET/POST checkin-permission`, `GET schedule/upcoming` | Lateness gate and "check-in permission"; effective working hours for today and the coming days |
| `GET remote/today`, `remote/history`; `POST remote/start`, `remote/end`, `remote/break/start`, `remote/break/end` | Remote work |
| `GET leave-types`, `GET/POST leave`, `GET leave/:id/attachment` | Leave |
| `POST mission`, `mission/now`, `mission/now/end`, `missions/:id/cancel`, `missions/:id/attachment`; `GET missions`, `mission/day`; `DELETE missions/:id` | Mission |
| `GET/PUT plan`, `POST plan/seen`, `plan/submit`, `GET plan-gate`, `week-board` | Weekly plan and check-out gate (a started week ⇒ read-only, writing ⇒ 409 `PLAN_LOCKED`) |
| `GET daily-tasks`, `report-backfill`; `POST daily-report`, `daily-report/undo`; `PATCH daily-report/note` | Daily task report (low-priority tasks are optional) |
| `POST my-urgent`; `PATCH/DELETE my-urgent/:id` | Personal urgent task |
| `GET team-review`; `POST report-reviews` | View the team's reports (supervisor) |
| `GET/POST dispute`, `GET dispute/:id`, `POST dispute/:id/(messages\|reopen\|close)` | Dispute and its conversation |

### Admin panel (`/admin/*`)
| Area | Routes |
|---|---|
| Login | `POST auth/webapp`, `auth/token`, `auth/code`, `auth/telegram`, `auth/logout`; `GET public-config` |
| Overview | `GET me`, `dashboard`, `overview`, `live`, `nightly-review`, `calendar` |
| "My Status" (all roles, own data only) | `GET me/week`, `me/tasks/(today\|backfill\|pending-count)`; `POST me/tasks/(answer\|undo)`; `PATCH me/tasks/note`; `GET me/urgent/config`, `POST me/urgent`, `PATCH/DELETE me/urgent/:id` |
| Employees | `GET/POST users`, `GET users/export`, `GET/PATCH/DELETE users/:id`, `GET users/:id/details`, `POST users/:id/message` |
| Attendance | `GET attendance`, `attendance/export`; `GET/POST/PATCH/DELETE attendance-records…`; `POST attendance-records/:id/breaks`; `PATCH/DELETE break-records/:id`; overtime approval `GET overtime-approvals`, `POST overtime-approvals/:recordId/(approve\|reject)` |
| Leave / mission | `GET/POST/PATCH/DELETE leave-requests…`, `GET leave-queue`, `POST leave-queue/bulk`, `GET leave-balances`, `POST leave-balances/adjust`, `PUT leave-balances/entitlement`, leave types |
| Remote work | `GET remote-work`, `remote-work/count`; `POST remote-work/approve-batch`, `remote-work/:id/(approve\|reject)` |
| Disputes | `GET disputes`, `disputes/counts`, `disputes/:id`; `POST disputes/:id/messages`, `disputes/:id/(resolve\|reopen)` |
| Shifts and work schedule | `GET/POST shifts…`, `PUT users/:id/shift`, `POST shifts/assign`; `GET users/:id/schedule`, `PUT/DELETE users/:id/schedule/:date`, `POST schedule/bulk` |
| Check-in permission | `GET checkin-permissions`, `POST checkin-permissions/:id/decide` |
| Team weekly plan | `GET users/:id/plan`, `plan-overview`, `users/:id/week`; `POST users/:id/plan/tasks`, `plan/reorder`, `plan/notify`; `PATCH/DELETE plan-tasks/:taskId`; `PUT users/:id/plan/supervisor-comment`; `POST plan-gate/exemptions` |
| Tasks and review | `POST users/:id/urgent-tasks`, `GET urgent-tasks`, `DELETE urgent-tasks/:taskId`; `GET team-review`, `team-reports`, `team-reports/export`, `task-kpis`; `POST report-reviews` |
| Reports and analytics | `GET reports/summary`, `reports/export`; `GET analytics/(late-trend\|late-compare\|rankings\|attendance-rate\|leave-by-type\|checkin-distribution\|patterns)` |
| Month closing | `GET month-closures`, `month-closures/:y/:m/(checklist\|adjustments)`; `POST month-closures/:y/:m/(close\|reopen)` |
| Control and notifications | `GET suspicious`, `POST suspicious/:id/review`; `GET notifications`, `notifications/unread-count`; `POST notifications/read-all`, `notifications/:id/read` |
| Holidays and settings | `GET/POST/DELETE holidays`, `GET/PATCH settings` |
| System (admin only) | `GET audit-log`, `audit-log/export`, `audit-actions`; `POST broadcast`; `GET system`, `system/status`, `system/backup`; reset: `GET system/reset/options`, `POST system/reset/preview`, `POST system/reset` |

## Telegram Bot and Jobs

Polling (no webhook and no inbound port). Everything is done from the **"📂 Menu"** button, which is the only keyboard button at the bottom of the chat; tapping it opens a role-based inline menu (2 columns, grouped as "My tasks / Team / Management", with "✖️ Close menu") that is cleared after a choice is made. "🕒 Record attendance", "📋 Weekly plan" and "⚙️ Admin panel" are inline buttons of type `web_app` (https only). Telegram's "/" menu is intentionally empty; only `/start` works. A user who still has the old keyboard gets the new one on their first tap; to replace it for everyone at once: `node src/scripts/pushPanelButton.js --apply`.

| Role | Menu options |
|---|---|
| Employee | "🕒 Record attendance", "📊 My status", "📈 My report", "🏖 Leave / 🚗 Mission", "📋 Weekly plan", "🖥 Panel", "❓ Help" |
| Supervisor | + "👥 Team report", "📥 Pending requests", "💬 Disputes", "📝 Team's yesterday reports", "👤 Member list" |
| Admin | + "➕ Add employee", "🛠 Fix record", "⚙️ Admin panel" |

In multi-step flows, dates are picked with an inline Jalali calendar, times with 30-minute slots, and employees/supervisors from a button list (typing `YYYY-MM-DD` / `HH:MM` is also accepted); every step has "❌ Cancel | 🏠 Main menu" underneath. Only free text (name, description, reason) is still typed. The state of multi-step conversations is held in memory and is lost when the process restarts.

**`node-cron` Jobs** (`src/bot/scheduler/`):

| Category | Jobs |
|---|---|
| Reminders | Late check-in, check-out, urgent-task deadline (every 10 minutes), leave approval, remote work |
| Calculation and maintenance | Marking holidays/leave, closing incomplete records, daily backup, Audit archive, database maintenance |
| Reports | Daily / weekly / monthly (Jalali month), morning digest, nightly review, nightly task report, report documents |
| Supervisors | Automatic creation of the mandatory "review yesterday's report" task (every day at 00:10, `CRON_TEAM_REVIEW_ENSURE`) |
| Monitoring | **watchdog** (Telegram alert to admins) |

Every Job run is recorded in the `job_runs` table and shown in the panel (Admin → "System status"). The `CRON_*` expressions in `.env` (and some in the panel settings) are configurable; **the defaults assume Saturday to Wednesday — adjust them to your actual working days.**

## Security and Monitoring

- Security headers and CSP (`CSP_MODE`, default `report-only`), HSTS, `HttpOnly` cookie with `SameSite=Strict`, CSRF, session revocation
- Persistent rate limiting on attendance and panel login (SQLite; not reset by a restart)
- Default-deny for the employee role; startup secret checks, `secret-scan`, and a release packager that strips secrets
- Non-editable Audit Log (with monthly archive) and suspicious events (same IP, device change)
- Monitoring: `GET /api/health`, `GET /api/admin/system/status`, and watchdog Telegram alerts for disk, polling, Job failure and backup staleness

Details of each item are in [`docs/DOCUMENTATION.md`](docs/DOCUMENTATION.md) (section "Security, secrets and monitoring").

## Deployment (Windows + NSSM)

1. `npm install --omit=dev` and fill in `.env` (`NODE_ENV=production`).
2. HTTPS certificate with DNS-01: `scripts/setup-ssl-renewal.ps1` (semi-manual; see the explanation inside the script). Put the paths in `SSL_CERT_PATH`/`SSL_KEY_PATH`.
3. Install the service: `scripts/install-service.ps1` (NSSM, auto-start, log rotation, restart on crash; default service name `FarazHonarAttendance`).
4. In BotFather: `/setdomain` for the panel domain (required for the Login Widget).
5. Every upgrade: `nssm stop` → replace the code → `npm install` → `npm run migrate` → `nssm start`.

Phase upgrades (additive only; no mandatory `.env` change except where noted):

| Phase | Migrations | Notes |
|---|---|---|
| 10 | 023–026 | Weekly-plan / daily-report gates and the Go-Live lock are off by default; new `.env`: `CRON_MORNING_DIGEST`, `ALLOW_DATA_RESET` |
| 11 | 027 | New setting `disputeMaxReopens` |
| 12 | 028–032 | Paid breaks and the lateness limit are off by default |
| 13 | 033–035 | No `.env` change |
| 14 | 036–038 | Remote work; check `ALLOWED_NETWORK_CIDR` and `TRUST_PROXY` |
| 15 | 039 | "My Day", task completion note |
| 16–19 | 040–042 | UI redesign, lunch / breaks / re-entry; the main change is on the front-end side |

Commands and the manual-test checklist for each phase: [`docs/DOCUMENTATION.md`](docs/DOCUMENTATION.md) (section "Phases").

> The PowerShell scripts must be tried once on a real Windows machine with Administrator privileges.

## Backup and Restore

A daily automatic backup (`CRON_DAILY_BACKUP`) and a backup before every migration are written to `data/backups/`; a manual backup from the panel (Admin → System → Backup) is also possible. Restore with `scripts/restore-backup.js`. Full step-by-step guide: [`BACKUP_RESTORE.md`](BACKUP_RESTORE.md).

## Testing

```bash
npm test             # all tests (node:test, no extra dependencies)
npm run test:watch   # re-run on every change
npm run smoke        # real server on a temporary database + a few key requests
npm run secret-scan  # search the project for tokens/keys/secrets (exit code 1 = findings)
npm run package      # delivery zip without .env/.ssl/data/node_modules/.git → dist/
```

The tests are hermetic: a temporary database, fake tokens and secrets, and the real `.env` is never read. Last recorded run in `PROJECT_STATUS.md`: 2,643 tests in 532 suites, no failures. Coverage areas:

- **Core and security:** migrations, `initData` and Login Widget, session, `networkRestriction`, the role × route access matrix and route ordering, headers/CSP, cookie, CSRF, session revocation, secret checks and scanner, release packager
- **Operations and monitoring:** Job run recording, polling heartbeat, watchdog with a mocked bot, `/api/health` and `/api/admin/system/status`
- **Attendance and calculation:** the `computeDay` engine, breaks and paid breaks, lunch, re-entry/segments, shifts and day-by-day schedule, lateness limit and check-in permission, remote work
- **Leave and mission:** validation, effect on working hours, nightly confirmation, balances, approval chain
- **Plan and tasks:** weekly plan and check-out gates (`PLAN_LOCKED`), daily report, urgent tasks, "My Day", manager view, nightly report, the supervisor's mandatory task
- **Bot:** role-based menu, button pickers, typeable time input
- **UI:** static CSS / accessibility / contrast tests, state coverage of each page (per the "UI states" table in `docs/DOCUMENTATION.md`), Jalali dates and panel regression

## Current Status and Open Items

Phases 1 to 19 are complete in code and automated tests. Open items (details in [`PROJECT_STATUS.md`](PROJECT_STATUS.md)):

- **Manual testing in the real environment:** the polling bot and `initData`/Login Widget on real Telegram, HTTPS/DNS-01, the NSSM/win-acme scripts, and the panel and Mini App UI in a browser/Telegram (320/390/768/1440px, both themes, RTL, screen reader, iOS/Android)
- **Before every deployment:** `npm test && npm run smoke && npm run secret-scan` on the target system (some development environments lacked a native `better-sqlite3`)
- **Official overtime rules** (cap, multiplier, rounding) have not yet been finalized with the employer
- **Lazy-loading of panel views** has been deferred to a separate architecture phase
- **Choosing the domain's DNS provider** so that SSL renewal can be fully automated