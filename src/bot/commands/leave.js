// جریان چندمرحله‌ای /leave: نوع → تاریخ شروع → تاریخ پایان → توضیح → تأیید نهایی.
// وضعیت مکالمه در src/bot/session.js نگه‌داری می‌شود (فقط در حافظه، نه دیتابیس).

const { getRegisteredUser, notRegisteredMessage } = require('../auth');
const session = require('../session');
const leaveRepository = require('../../repositories/leaveRepository');
const usersRepository = require('../../repositories/usersRepository');
const auditRepository = require('../../repositories/auditRepository');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidDate(str) {
  if (!DATE_RE.test(str)) return false;
  const d = new Date(str);
  return !Number.isNaN(d.getTime());
}

async function notifyApprovers(bot, employee, request) {
  // مدیر مستقیم اگر تعریف شده، وگرنه همه ادمین‌ها
  const approvers = employee.manager_id
    ? [usersRepository.findById(employee.manager_id)].filter(Boolean)
    : usersRepository.listUsers({ onlyActive: true }).filter((u) => u.role === 'admin');

  const typeLabel = request.leave_type === 'mission' ? 'مأموریت' : 'مرخصی';
  const text = [
    `📥 درخواست ${typeLabel} جدید`,
    `از: ${employee.full_name}`,
    `بازه: ${request.start_date} تا ${request.end_date}`,
    request.reason ? `توضیح: ${request.reason}` : null,
    '',
    'برای بررسی از دستور /pending_leaves استفاده کنید.',
  ]
    .filter(Boolean)
    .join('\n');

  for (const approver of approvers) {
    if (!approver.telegram_user_id) continue;
    try {
      await bot.sendMessage(approver.telegram_user_id, text);
    } catch (err) {
      console.error('[bot] خطا در اطلاع‌رسانی به تأییدکننده:', err.message);
    }
  }
}

async function handleLeaveCommand(bot, msg) {
  const chatId = msg.chat.id;
  const user = getRegisteredUser(msg.from.id);
  if (!user) {
    await bot.sendMessage(chatId, notRegisteredMessage(msg.from.id), { parse_mode: 'Markdown' });
    return;
  }

  session.start(chatId, 'leave', { userId: user.id });
  await bot.sendMessage(chatId, 'نوع درخواست را انتخاب کنید:', {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '🏖 مرخصی', callback_data: 'leave_type:leave' },
          { text: '🚗 مأموریت', callback_data: 'leave_type:mission' },
        ],
        [{ text: '❌ لغو', callback_data: 'leave_cancel' }],
      ],
    },
  });
}

// مرحله‌های متنی (تاریخ شروع/پایان/توضیح)
async function handleLeaveText(bot, msg, sess) {
  const chatId = msg.chat.id;
  const text = (msg.text || '').trim();

  if (sess.step === 1) {
    if (!isValidDate(text)) {
      await bot.sendMessage(chatId, 'فرمت تاریخ نامعتبر است. لطفاً به‌صورت YYYY-MM-DD وارد کنید (مثال: 2026-09-25):');
      return;
    }
    session.update(chatId, { step: 2, data: { ...sess.data, startDate: text } });
    await bot.sendMessage(chatId, 'تاریخ پایان را وارد کنید (YYYY-MM-DD):');
    return;
  }

  if (sess.step === 2) {
    if (!isValidDate(text) || text < sess.data.startDate) {
      await bot.sendMessage(chatId, 'تاریخ پایان نامعتبر است یا قبل از تاریخ شروع است. دوباره وارد کنید:');
      return;
    }
    session.update(chatId, { step: 3, data: { ...sess.data, endDate: text } });
    await bot.sendMessage(chatId, 'توضیح کوتاه بنویسید (یا "-" برای رد شدن):');
    return;
  }

  if (sess.step === 3) {
    const reason = text === '-' ? null : text;
    const data = { ...sess.data, reason };
    session.update(chatId, { step: 4, data });

    const typeLabel = data.leaveType === 'mission' ? 'مأموریت' : 'مرخصی';
    const summaryLines = [
      'خلاصه درخواست:',
      `نوع: ${typeLabel}`,
      `از: ${data.startDate}`,
      `تا: ${data.endDate}`,
      `توضیح: ${reason || '—'}`,
      '',
      'ارسال شود؟',
    ];
    await bot.sendMessage(chatId, summaryLines.join('\n'), {
      reply_markup: {
        inline_keyboard: [
          [
            { text: '✅ تأیید و ارسال', callback_data: 'leave_confirm:yes' },
            { text: '❌ لغو', callback_data: 'leave_confirm:no' },
          ],
        ],
      },
    });
    return;
  }
}

async function handleLeaveCallback(bot, query, sess) {
  const chatId = query.message.chat.id;
  const [action, value] = query.data.split(':');

  if (action === 'leave_cancel') {
    session.clear(chatId);
    await bot.answerCallbackQuery(query.id);
    await bot.sendMessage(chatId, 'درخواست لغو شد.');
    return;
  }

  if (action === 'leave_type') {
    session.update(chatId, { step: 1, data: { ...sess.data, leaveType: value } });
    await bot.answerCallbackQuery(query.id);
    await bot.sendMessage(chatId, 'تاریخ شروع را وارد کنید (YYYY-MM-DD):');
    return;
  }

  if (action === 'leave_confirm') {
    await bot.answerCallbackQuery(query.id);
    if (value === 'no') {
      session.clear(chatId);
      await bot.sendMessage(chatId, 'درخواست لغو شد.');
      return;
    }

    const user = usersRepository.findById(sess.data.userId);
    const request = leaveRepository.createLeaveRequest({
      userId: user.id,
      startDate: sess.data.startDate,
      endDate: sess.data.endDate,
      leaveType: sess.data.leaveType,
      reason: sess.data.reason,
    });

    auditRepository.logEvent({
      userId: user.id,
      action: 'leave_request_created',
      details: { requestId: request.id, leaveType: request.leave_type },
    });

    session.clear(chatId);
    await bot.sendMessage(chatId, '✅ درخواست شما ثبت شد و برای تأیید ارسال شد.');
    await notifyApprovers(bot, user, request);
    return;
  }
}

module.exports = { handleLeaveCommand, handleLeaveText, handleLeaveCallback };
