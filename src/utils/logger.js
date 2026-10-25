const fs = require('fs');
const path = require('path');
const config = require('../config');
const ranks = { debug: 0, info: 1, warn: 2, error: 3 };
const sensitive = /token|secret|initdata|password|code|authorization/i;
function redact(value, key) { if (sensitive.test(key || '')) return '[REDACTED]'; if (Array.isArray(value)) return value.map((v) => redact(v)); if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redact(v, k)])); return value; }
function cleanup() { try { fs.mkdirSync(config.logDir, { recursive: true }); const cutoff = Date.now() - config.logKeepDays * 86400000; fs.readdirSync(config.logDir).forEach((file) => { const target = path.join(config.logDir, file); if (/^app-\d{4}-\d{2}-\d{2}\.log$/.test(file) && fs.statSync(target).mtimeMs < cutoff) fs.rmSync(target); }); } catch (_) {} }
function write(level, msg, meta) { if (ranks[level] < ranks[config.logLevel]) return; const line = JSON.stringify({ time: new Date().toISOString(), level, msg, ...(meta ? { meta: redact(meta) } : {}) }); const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log; fn(line); try { fs.mkdirSync(config.logDir, { recursive: true }); fs.appendFileSync(path.join(config.logDir, `app-${new Date().toISOString().slice(0, 10)}.log`), `${line}\n`); } catch (_) {} }
cleanup();
module.exports = { debug: (m, x) => write('debug', m, x), info: (m, x) => write('info', m, x), warn: (m, x) => write('warn', m, x), error: (m, x) => write('error', m, x), cleanup };
