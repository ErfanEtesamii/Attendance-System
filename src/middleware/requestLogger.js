const crypto = require('crypto');
const logger = require('../utils/logger');

const QUIET_PATH = /^(?:\/(?:css|js|fonts)(?:\/|$)|\/admin\/(?:css|js)(?:\/|$)|\/favicon\.ico$|\/api\/health$)/;

// درخواست‌های پرتکرارِ موفق (پولینگ و آیکن) فقط نویز لاگ‌اند؛ خطاها (۴xx/۵xx) همچنان لاگ می‌شوند
const QUIET_OK_PATH = /^(?:\/api)?\/(?:admin\/notifications\/unread-count|miniapp\/network-state|csp-report|icons\.svg)$/;

function requestLogger(req, res, next) {
  const startedAt = Date.now();
  req.id = crypto.randomBytes(4).toString('hex');
  res.setHeader('X-Request-Id', req.id);
  res.on('finish', () => {
    const pathname = req.path || req.url.split('?')[0];
    if (res.statusCode < 500 && QUIET_PATH.test(pathname)) return;
    if (res.statusCode < 400 && QUIET_OK_PATH.test(pathname)) return;
    logger.info('request', { id: req.id, method: req.method, path: pathname, status: res.statusCode, durationMs: Date.now() - startedAt, ip: req.ip });
  });
  next();
}
module.exports = { requestLogger };
