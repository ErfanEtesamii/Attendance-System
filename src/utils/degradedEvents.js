const logger = require('./logger');
const config = require('../config');

const events = new Map();
function report(kind, err) {
  const now = Date.now();
  const current = events.get(kind) || { count: 0, lastAlertAt: 0 };
  current.count += 1;
  current.lastAt = new Date(now).toISOString();
  current.lastError = String(err && err.message ? err.message : err || 'unknown').slice(0, 200);
  const throttle = config.monitor.alertThrottleMinutes * 60000;
  if (now - current.lastAlertAt >= throttle) {
    current.lastAlertAt = now;
    logger.warn('degraded_mode', { kind, count: current.count, error: current.lastError });
  }
  events.set(kind, current);
}
function snapshot() { return [...events.entries()].map(([kind, value]) => ({ kind, count: value.count, lastAt: value.lastAt })); }
module.exports = { report, snapshot };
