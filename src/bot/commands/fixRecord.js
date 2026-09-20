// /fix_record: طبق سند، اصلاح دستی رکورد فقط توسط ادمین کل مجاز است و باید
// «چه‌کسی، چه‌زمانی، چرا» به‌صورت اجباری در audit_log ثبت شود.

const { getRegisteredUser, notRegisteredMessage, hasRole } = require('../auth');
const session = require('../session');
const usersRepository = require('../../repositories/usersRepository');
const attendanceRepository = require('../../repositories/attendanceRepository');
const auditRepository = require('../../repositories/auditRepository');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;
const STATUS_OPTIONS = ['normal', 'late', 'incomplete', 'leave', 'holiday'];

async function handleFixRecordCommand(bot, msg) {
  const chatId = msg.chat.id;
  const user = getRegisteredUser(msg.from.id);
  if (!user) {
    await bot.sendMessage(chatId, notRegisteredMessage(msg.from.id), { parse_mode: 'Markdown' });
    return;
  }
  if (!hasRole(user, ['admin'])) {
    await bot.sendMessage(chatId, '⛔️ اصلاح دستی رکورد فقط توسط ادمین کل مجاز است.');
    return;
  }

  session.start(chatId, 'fix_record', { adminId: user.id });
  await bot.sendMessage(chatId, 'آیدی تلگرام کارمند مورد نظر را وارد کنید:');
}

async function handleFixRecordText(bot, msg, sess) {
  const chatId = msg.chat.id;
  const text = (msg.text || '').trim();

  if (sess.step === 0) {
    const employee = usersRepository.findByTelegramId(text);
    if (!employee) {
      await bot.sendMessage(chatId, 'کارمندی با این آیدی تلگرام پیدا نشد. دوباره وارد کنید:');
      return;
    }
    session.update(chatId, { step: 1, data: { ...sess.data, employeeId: employee.id, employeeName: employee.full_name } });
    await bot.sendMessage(chatId, `تاریخ رکورد را وارد کنید (YYYY-MM-DD):`);
    return;
  }

  if (sess.step === 1) {
    if (!DATE_RE.test(text)) {
      await bot.sendMessage(chatId, 'فرمت تاریخ نامعتبر است. دوباره وارد کنید (YYYY-MM-DD):');
      return;
    }
    const [record] = attendanceRepository.listByUserAndRange(sess.data.employeeId, text, text);
    if (!record) {
      await bot.sendMessage(chatId, 'رکوردی برای این کارمند در این تاریخ یافت نشد. عملیات لغو شد.');
      session.clear(chatId);
      return;
    }

    session.update(chatId, { step: 2, data: { ...sess.data, recordId: record.id, recordDate: text } });
    await bot.sendMessage(
      chatId,
      [
        `رکورد ${sess.data.employeeName} — ${text}`,
        `ورود: ${record.check_in_time || '—'}`,
        `خروج: ${record.check_out_time || '—'}`,
        `وضعیت: ${record.status}`,
        '',
        'کدام فیلد اصلاح شود؟',
      ].join('\n'),
      {
        reply_markup: {
          inline_keyboard: [
            [
              { text: 'زمان ورود', callback_data: 'fix_field:check_in_time' },
              { text: 'زمان خروج', callback_data: 'fix_field:check_out_time' },
            ],
            [{ text: 'وضعیت', callback_data: 'fix_field:status' }],
            [{ text: '❌ لغو', callback_data: 'fix_cancel' }],
          ],
        },
      }
    );
    return;
  }

  if (sess.step === 3) {
    // مقدار جدید برای check_in_time / check_out_time به‌صورت HH:mm
    if (!TIME_RE.test(text)) {
      await bot.sendMessage(chatId, 'فرمت زمان نامعتبر است. به‌صورت HH:mm وارد کنید (مثال: 08:30):');
      return;
    }
    const newValueIso = new Date(`${sess.data.recordDate}T${text}:00`).toISOString();
    session.update(chatId, { step: 4, data: { ...sess.data, newValue: newValueIso } });
    await bot.sendMessage(chatId, 'دلیل این اصلاح را وارد کنید (اجباری):');
    return;
  }

  if (sess.step === 4) {
    if (!text) {
      await bot.sendMessage(chatId, 'ذکر دلیل اجباری است. لطفاً دلیل را وارد کنید:');
      return;
    }
    await finalizeFix(bot, chatId, { ...sess.data, reason: text });
    return;
  }
}

async function handleFixRecordCallback(bot, query, sess) {
  const chatId = query.message.chat.id;

  if (query.data === 'fix_cancel') {
    session.clear(chatId);
    await bot.answerCallbackQuery(query.id);
    await bot.sendMessage(chatId, 'عملیات لغو شد.');
    return;
  }

  const [, field] = query.data.split(':');
  await bot.answerCallbackQuery(query.id);

  if (field === 'status') {
    session.update(chatId, { step: 3.5, data: { ...sess.data, field } });
    await bot.sendMessage(chatId, 'وضعیت جدید را انتخاب کنید:', {
      reply_markup: {
        inline_keyboard: [STATUS_OPTIONS.map((s) => ({ text: s, callback_data: `fix_status:${s}` }))],
      },
    });
    return;
  }

  session.update(chatId, { step: 3, data: { ...sess.data, field } });
  await bot.sendMessage(chatId, 'مقدار جدید را به‌صورت HH:mm وارد کنید (بر اساس همان تاریخ رکورد):');
}

async function handleFixStatusCallback(bot, query, sess) {
  const chatId = query.message.chat.id;
  const [, status] = query.data.split(':');
  await bot.answerCallbackQuery(query.id);
  session.update(chatId, { step: 4, data: { ...sess.data, newValue: status } });
  await bot.sendMessage(chatId, 'دلیل این اصلاح را وارد کنید (اجباری):');
}

async function finalizeFix(bot, chatId, data) {
  const before = attendanceRepository.findById(data.recordId);
  const updated = attendanceRepository.manualUpdate(data.recordId, { [data.field]: data.newValue });

  auditRepository.logEvent({
    userId: data.adminId,
    action: 'record_manually_fixed',
    details: {
      employeeId: data.employeeId,
      recordId: data.recordId,
      field: data.field,
      before: before[data.field],
      after: data.newValue,
      reason: data.reason,
    },
  });

  session.clear(chatId);
  await bot.sendMessage(
    chatId,
    `✅ رکورد اصلاح شد.\nفیلد: ${data.field}\nمقدار جدید: ${updated[data.field]}\nدلیل: ${data.reason}`
  );
}

module.exports = {
  handleFixRecordCommand,
  handleFixRecordText,
  handleFixRecordCallback,
  handleFixStatusCallback,
};
