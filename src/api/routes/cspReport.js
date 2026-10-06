// دریافت گزارش تخلف CSP (بخش ۲-الف). عمومی و بدون احراز هویت است (مرورگر کوکی نمی‌فرستد)،
// پس: بدنه کوچک، rate limit، فقط لاگ (هیچ نوشتن در دیتابیس) و حذف تکراری‌ها.
const express = require('express');
const router = express.Router();
const { createRateLimiter } = require('../../middleware/rateLimiter');

const limiter = createRateLimiter({ windowMs: 60 * 1000, max: 30, message: 'rate limited' });
const parser = express.json({ limit: '16kb', type: ['application/csp-report', 'application/reports+json', 'application/json'] });

const seen = new Set();
const MAX_SEEN = 200;

const clip = (v) => String(v == null ? '' : v).slice(0, 200);

// هر دو قالب report-uri ({"csp-report": {...}}) و Reporting API (آرایه‌ی {type:'csp-violation', body})
function extractReports(body) {
  if (!body) return [];
  if (Array.isArray(body)) return body.filter((r) => r && r.body).map((r) => r.body);
  if (body['csp-report']) return [body['csp-report']];
  return [];
}

router.post('/csp-report', limiter, parser, (req, res) => {
  try {
    for (const r of extractReports(req.body)) {
      const directive = clip(r['violated-directive'] || r.effectiveDirective || r['effective-directive']);
      const blocked = clip(r['blocked-uri'] || r.blockedURL);
      const source = clip(r['source-file'] || r.sourceFile);
      const key = `${directive}|${blocked}|${source}`;
      if (seen.has(key) || seen.size >= MAX_SEEN) continue;
      seen.add(key);
      console.warn(`[CSP] تخلف: directive=${directive} blocked=${blocked} source=${source} page=${clip(r['document-uri'] || r.documentURL)}`);
    }
  } catch (_) { /* گزارش خراب نباید خطا بسازد */ }
  res.status(204).end();
});

module.exports = router;
