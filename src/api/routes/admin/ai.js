// ایجنت هوش مصنوعی پنل (فقط admin).
//   GET  /admin/ai/status   ⇒ { enabled }
//   POST /admin/ai/chat     body: { messages: [{role:'user'|'assistant', content}] } ⇒ { reply, tools, usage }
// ایجنت فقط‌خواندنی است (ابزارهای src/services/aiAgent/tools.js). متن پرسش در ممیزی ثبت می‌شود (بدون پاسخ مدل).
const express = require('express');
const router = express.Router();
const { requirePermission } = require('../../../middleware/permissions');
const { createRateLimiter } = require('../../../middleware/rateLimiter');
const auditRepository = require('../../../repositories/auditRepository');
const config = require('../../../config');
const agent = require('../../../services/aiAgent/agent');
const actions = require('../../../services/aiAgent/actions');
const { takeExport } = require('../../../services/aiAgent/moreTools');

const chatLimiter = createRateLimiter({
  name: 'ai-chat',
  windowMs: 60 * 1000,
  max: config.ai.perMinuteLimit,
  keyFn: (req) => `u${req.adminUser && req.adminUser.id}`,
  message: 'تعداد پرسش‌ها به ایجنت بیش از حد مجاز است؛ یک دقیقه صبر کنید.',
});

router.get('/admin/ai/status', requirePermission('ai.assistant'), (req, res) => {
  res.json({ enabled: agent.isEnabled() });
});

router.post('/admin/ai/chat', requirePermission('ai.assistant'), chatLimiter, async (req, res, next) => {
  const body = req.body || {};
  try {
    const out = await agent.chat({ adminUser: req.adminUser, messages: body.messages });
    try {
      const last = [...body.messages].reverse().find((m) => m && m.role === 'user');
      auditRepository.logEvent({
        userId: req.adminUser.id,
        action: 'ai_assistant_query',
        ipAddress: req.ip || null,
        details: { question: String(last && last.content).slice(0, 300), tools: out.tools.map((t) => t.name), tokens: out.usage },
      });
    } catch (_) { /* ممیزی بهترین‌تلاش است */ }
    res.json(out);
  } catch (err) {
    if (err instanceof agent.AiAgentError) return res.status(err.status).json({ error: err.message, code: err.code });
    return next(err); // Express 4: خطای async باید صریح به errorHandler برسد
  }
});

// تأیید/لغو عملیات پیشنهادیِ ایجنت (فقط همان ادمین، یک‌بار، قبل از انقضا؛ مجوز و اسکوپ دوباره سنجیده می‌شود)
router.post('/admin/ai/actions/:id/:verb(confirm|cancel)', requirePermission('ai.assistant'), (req, res, next) => {
  try {
    const out = req.params.verb === 'confirm' ? actions.confirm(req.adminUser, req.params.id, { ip: req.ip }) : actions.cancel(req.adminUser, req.params.id);
    res.json(out);
  } catch (err) {
    if (err instanceof actions.ActionError) return res.status(400).json({ error: err.message });
    return next(err);
  }
});

// دانلود خروجی اکسلِ ساخته‌شده توسط ایجنت (توکن تصادفی، فقط صاحبش، ۳۰ دقیقه)
router.get('/admin/ai/export/:token', requirePermission('ai.assistant'), (req, res) => {
  const e = /^[0-9a-f]{32}$/.test(req.params.token) ? takeExport(req.adminUser.id, req.params.token) : null;
  if (!e) return res.status(404).json({ error: 'فایل یافت نشد یا منقضی شده است.' });
  return res.download(e.file, e.name);
});

module.exports = router;
