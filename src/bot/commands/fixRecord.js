// «🛠 اصلاح رکورد» (دکمه‌ی منوی ادمین): طبق سند، اصلاح دستی رکورد فقط توسط ادمین کل مجاز است و باید
// «چه‌کسی، چه‌زمانی، چرا» به‌صورت اجباری در audit_log ثبت شود.

const { getRegisteredUser, notRegisteredMessage, hasRole } = require('../auth');
const session = require('../session');
const usersRepository = require('../../repositories/usersRepository');
const attendanceRepository = require('../../repositories/attendanceRepository');
const auditRepository = require('../../repositories/auditRepository');
const ui = require('../ui/pickers');
const { todayDateString } = require('../../utils/serverTime');

// E3: کارمند از فهرست دکمه‌ای، تاریخ از تقویم شمسی، ساعت از اسلات ۳۰ دقیقه‌ای؛ فقط «دلیل» تایپ می‌شود (اجباری، بدون «رد شدن»).
// تایپ آیدی تلگرام / YYYY-MM-DD / HH:mm هم همچنان پذیرفته است. نقش ادمین هر بار سمت سرور دوباره چک می‌شود.

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
  await ui.askEmployee(bot, chatId, { text: 'کارمند مورد نظر را انتخاب کنید (یا آیدی عددی تلگرامش را تایپ کنید):', label: 'کارمند', filter: 'any' });
}

function sessionAdmin(sess) {
  const admin = sess && sess.data && sess.data.adminId ? usersRepository.findById(sess.data.adminId) : null;
  return admin && admin.is_active && admin.role === 'admin' ? admin : null;
}

// بعد از انتخاب کارمند (از فهرست یا تایپ): مرحله‌ی تاریخ
async function proceedWithEmployee(bot, chatId, sess, employee) {
  session.update(chatId, { step: 1, data: { ...sess.data, employeeId: employee.id, employeeName: employee.full_name } });
  await ui.askDate(bot, chatId, {
    text: 'تاریخ رکورد را از تقویم انتخاب کنید (یا به‌صورت YYYY-MM-DD تایپ کنید):',
    label: 'تاریخ رکورد',
    max: todayDateString(),
    quick: ui.quickDates([-1, 0]),
  });
}

// انتخاب کارمند از فهرست (pickerRouter)
async function handleEmployeePick(bot, chatId, sess, chosen) {
  if (!sess || sess.flow !== 'fix_record' || sess.step !== 0 || !chosen) return;
  if (!sessionAdmin(sess)) {
    session.clear(chatId);
    await bot.sendMessage(chatId, '⛔️ اصلاح دستی رکورد فقط توسط ادمین کل مجاز است.');
    return;
  }
  await proceedWithEmployee(bot, chatId, sess, chosen);
}

async function handleFixRecordText(bot, msg, sess) {
  const chatId = msg.chat.id;
  const text = (msg.text || '').trim();

  if (sess.step === 0) {
    const employee = usersRepository.findByTelegramId(text);
    if (!employee) {
      await ui.retry(bot, chatId, 'کارمندی با این آیدی تلگرام پیدا نشد. از فهرست بالا انتخاب کنید یا دوباره تایپ کنید:');
      return;
    }
    await proceedWithEmployee(bot, chatId, sess, employee);
    return;
  }

  if (sess.step === 1) {
    if (!DATE_RE.test(text)) {
      await ui.retry(bot, chatId, 'فرمت تاریخ نامعتبر است. از تقویم بالا انتخاب کنید یا به‌صورت YYYY-MM-DD تایپ کنید:');
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
        reply_markup: ui.withNav([
          [
            { text: 'زمان ورود', callback_data: 'fix_field:check_in_time' },
            { text: 'زمان خروج', callback_data: 'fix_field:check_out_time' },
          ],
          [{ text: 'وضعیت', callback_data: 'fix_field:status' }],
        ], { cancelData: 'fix_cancel' }),
      }
    );
    return;
  }

  if (sess.step === 3) {
    // مقدار جدید برای check_in_time / check_out_time به‌صورت HH:mm
    if (!TIME_RE.test(text)) {
      await ui.retry(bot, chatId, 'فرمت زمان نامعتبر است. از دکمه‌های بالا انتخاب کنید یا به‌صورت HH:mm تایپ کنید (مثال: 08:30):');
      return;
    }
    const newValueIso = new Date(`${sess.data.recordDate}T${text}:00`).toISOString();
    session.update(chatId, { step: 4, data: { ...sess.data, newValue: newValueIso } });
    await ui.askText(bot, chatId, 'دلیل این اصلاح را بنویسید (اجباری):');
    return;
  }

  if (sess.step === 4) {
    if (!text) {
      await ui.retry(bot, chatId, 'ذکر دلیل اجباری است. لطفاً دلیل را بنویسید:');
      return;
    }
    if (!sessionAdmin(sess)) {
      session.clear(chatId);
      await bot.sendMessage(chatId, '⛔️ اصلاح دستی رکورد فقط توسط ادمین کل مجاز است.');
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
  if (!sess || sess.flow !== 'fix_record' || sess.step !== 2 || !['check_in_time', 'check_out_time', 'status'].includes(field)) {
    await ui.expire(bot, query); // دکمه‌ی مرحله‌ی قدیمی
    return;
  }
  await bot.answerCallbackQuery(query.id);

  if (field === 'status') {
    session.update(chatId, { step: 3.5, data: { ...sess.data, field } });
    await bot.sendMessage(chatId, 'وضعیت جدید را انتخاب کنید:', {
      reply_markup: ui.withNav([STATUS_OPTIONS.map((s) => ({ text: s, callback_data: `fix_status:${s}` }))], { cancelData: 'fix_cancel' }),
    });
    return;
  }

  session.update(chatId, { step: 3, data: { ...sess.data, field } });
  await ui.askTime(bot, chatId, {
    text: `${field === 'check_in_time' ? 'زمان ورود' : 'زمان خروج'} جدید را انتخاب کنید (یا به‌صورت HH:mm تایپ کنید؛ بر اساس همان تاریخ رکورد):`,
    label: field === 'check_in_time' ? 'زمان ورود' : 'زمان خروج',
    cancelData: 'fix_cancel',
  });
}

async function handleFixStatusCallback(bot, query, sess) {
  const chatId = query.message.chat.id;
  const [, status] = query.data.split(':');
  if (!sess || sess.flow !== 'fix_record' || sess.step !== 3.5 || !STATUS_OPTIONS.includes(status)) {
    await ui.expire(bot, query);
    return;
  }
  await bot.answerCallbackQuery(query.id);
  session.update(chatId, { step: 4, data: { ...sess.data, newValue: status } });
  await ui.askText(bot, chatId, 'دلیل این اصلاح را بنویسید (اجباری):');
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
  handleEmployeePick,
};
