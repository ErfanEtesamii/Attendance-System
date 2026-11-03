// گزارش/هشدار هوشمند برای ادمین‌ها در تلگرام (رایگان: بر پایه‌ی قانون، بدون فراخوانی مدل). با AI_DIGEST_ENABLED=true فعال می‌شود.
const config = require('../../config');
const { getDb } = require('../../db/connection');
const notifier = require('../notifier');
const insights = require('../../services/aiAgent/insights');

async function sendAiDigest() {
  if (!config.ai.digestEnabled) return;
  const fresh = insights.takeNew(insights.collect());
  if (!fresh.length) return;
  const admins = getDb().prepare(`SELECT telegram_user_id t FROM users WHERE role='admin' AND is_active=1 AND telegram_user_id IS NOT NULL`).all();
  const text = `🤖 تحلیلگر هوشمند\n\n${fresh.map((f) => f.text).join('\n')}`;
  for (const a of admins) await notifier.sendMessage(a.t, text);
}

module.exports = { sendAiDigest };
