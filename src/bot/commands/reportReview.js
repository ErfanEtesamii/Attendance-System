// D11: «👁 مشاهده شد» و «💬 کامنت» روی گزارش شبانه‌ی تسک‌ها. همه‌ی قواعد (نقش، اسکوپ تیم، ماه بسته، اعلان به کارمند)
// در teamReviewService.markReviewed است؛ اینجا فقط callback/متن بات. callback_data: rvs:<userId>:<YYYY-MM-DD> | rvc:<userId>:<YYYY-MM-DD>
const { getRegisteredUser } = require('../auth');
const session = require('../session');
const teamReviewService = require('../../services/teamReviewService');

const CANCEL_WORD = 'انصراف';

function parse(data) {
  const m = /^rv[sc]:(\d+):(\d{4}-\d{2}-\d{2})$/.exec(data || '');
  return m ? { subjectUserId: Number(m[1]), reportDate: m[2] } : null;
}

async function handleReportReviewCallback(bot, query) {
  const target = parse(query.data);
  const actor = getRegisteredUser(query.from.id);
  if (!target || !actor) return bot.answerCallbackQuery(query.id, { text: 'این دکمه منقضی شده است.', show_alert: true });
  if (query.data.startsWith('rvs:')) {
    const res = teamReviewService.markReviewed(actor, target);
    return bot.answerCallbackQuery(query.id, { text: res.ok ? 'ثبت شد: مشاهده شد ✅' : res.error, show_alert: !res.ok });
  }
  if (!teamReviewService.isReviewer(actor)) return bot.answerCallbackQuery(query.id, { text: 'اجازه‌ی این عملیات را ندارید.', show_alert: true });
  session.start(query.message.chat.id, 'report_comment', target);
  await bot.answerCallbackQuery(query.id);
  return bot.sendMessage(query.message.chat.id, `کامنت خود را برای این گزارش بنویسید (حداکثر ${teamReviewService.COMMENT_MAX} نویسه). برای انصراف «${CANCEL_WORD}» بفرستید.`);
}

async function handleReportCommentText(bot, msg, sess) {
  const chatId = msg.chat.id;
  const text = (msg.text || '').trim();
  if (text === CANCEL_WORD) { session.clear(chatId); return bot.sendMessage(chatId, 'انصراف داده شد.'); }
  const actor = getRegisteredUser(msg.from.id);
  const res = actor ? teamReviewService.markReviewed(actor, { ...sess.data, comment: text }) : { ok: false, error: 'دسترسی ندارید.', code: 'FORBIDDEN' };
  if (!res.ok) {
    if (res.code !== 'COMMENT_TOO_LONG') session.clear(chatId);
    return bot.sendMessage(chatId, res.error);
  }
  session.clear(chatId);
  return bot.sendMessage(chatId, 'کامنت ثبت شد و برای کارمند ارسال می‌شود ✅');
}

module.exports = { handleReportReviewCallback, handleReportCommentText, parse };
