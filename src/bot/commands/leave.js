// جریان چندمرحله‌ای /leave (S4-10b): نوع (از انواع فعالِ leave_types) → واحد (فقط اگر نوع بیش از یک واحد بپذیرد) →
//   روزانه: تاریخ شروع → تاریخ پایان | نیم‌روز: تاریخ → صبح/عصر | ساعتی: تاریخ → ساعت شروع → ساعت پایان
//   → توضیح → خلاصه (مدت و هشدارها از leaveService.validate) → تأیید ⇒ leaveService.create.
// همه‌ی قواعد (تداخل، مانده، گذشته/آینده، پیش‌اطلاع، سقف روز متوالی) فقط در leaveService است؛ بات فقط پیام را نمایش می‌دهد.
// مقدار قدیمیِ leave_type:leave|mission و sessionی که unit ندارد (= روزانه) هنوز کار می‌کند.
// وضعیت مکالمه در src/bot/session.js نگه‌داری می‌شود (فقط در حافظه، نه دیتابیس).
// E3: تاریخ با تقویم شمسی inline و ساعت با اسلات ۳۰ دقیقه‌ای انتخاب می‌شود (تایپ YYYY-MM-DD / HH:MM هم همچنان پذیرفته است)؛
//   زیر هر مرحله «❌ انصراف | 🏠 منوی اصلی»؛ دکمه‌ی مرحله‌ی قدیمی/منقضی ⇒ پیام «این دکمه منقضی شده». فقط توضیح تایپ می‌ماند (با «رد شدن»).

const { getRegisteredUser, notRegisteredMessage } = require('../auth');
const session = require('../session');
const usersRepository = require('../../repositories/usersRepository');
const auditRepository = require('../../repositories/auditRepository');
const notificationEvents = require('../../services/notificationEvents');
const leaveService = require('../../services/leaveService');
const leaveBalanceService = require('../../services/leaveBalanceService');
const leaveTypesRepository = require('../../repositories/leaveTypesRepository');
const attachmentService = require('../../services/attachmentService');
const { formatMinutes } = require('../../utils/leaveBalanceFormat');
const ui = require('../ui/pickers');
const { addDays } = require('../../utils/shiftDay');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;
const UNIT_LABEL = { day: '📅 روزانه', half_day: '🌗 نیم‌روز', hour: '⏱ ساعتی' };
const PART_LABEL = { morning: 'صبح', afternoon: 'عصر' };
const CANCEL = 'leave_cancel'; // callback انصرافِ همین جریان (پیام‌های قدیمی هم کار می‌کنند)

// «9:05» ⇒ «09:05»؛ نامعتبر ⇒ null
function normalizeTime(str) {
  const m = TIME_RE.exec(str);
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : null;
}

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

  const typeLabel = request.kind === 'mission' ? 'مأموریت' : 'مرخصی';
  const text = [
    `📥 درخواست ${typeLabel} جدید`,
    `از: ${employee.full_name}`,
    `بازه: ${request.start_date} تا ${request.end_date}`,
    request.reason ? `توضیح: ${request.reason}` : null,
  ]
    .filter(Boolean)
    .join('\n');
  // E4: به‌جای ارجاع به دستور، دکمه‌ی بررسی (همان handlerِ «📥 درخواست‌های منتظر»؛ نقش سمت سرور دوباره چک می‌شود)
  const options = { reply_markup: { inline_keyboard: [[{ text: '📥 درخواست‌های منتظر', callback_data: 'mn:pending_leaves' }]] } };

  for (const approver of approvers) {
    if (!approver.telegram_user_id) continue;
    try {
      await bot.sendMessage(approver.telegram_user_id, text, options);
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

  const types = leaveTypesRepository.listLeaveTypes({ activeOnly: true });
  if (!types.length) {
    await bot.sendMessage(chatId, 'در حال حاضر نوع درخواستی برای ثبت تعریف نشده است. با مدیر تماس بگیرید.');
    return;
  }
  session.start(chatId, 'leave', { userId: user.id });
  const rows = types.map((ty) => [{ text: `${ty.kind === 'mission' ? '🚗' : '🏖'} ${ty.title}`, callback_data: `leave_type:${ty.id}` }]);
  await bot.sendMessage(chatId, 'نوع درخواست را انتخاب کنید:', { reply_markup: ui.withNav(rows, { cancelData: CANCEL }) });
}

// ورودی leaveService از دادهٔ session (unit ندارد ⇒ روزانه)
function toServiceInput(data) {
  return {
    userId: data.userId,
    leaveTypeId: data.leaveTypeId,
    leaveType: data.leaveTypeId === undefined ? data.leaveType : undefined,
    unit: data.unit || 'day',
    startDate: data.startDate,
    endDate: data.endDate || data.startDate,
    halfDayPart: data.halfDayPart,
    startTime: data.startTime,
    endTime: data.endTime,
    reason: data.reason,
    attachment: data.attachment,
  };
}

async function askStartDate(bot, chatId, unit) {
  await ui.askDate(bot, chatId, {
    text: unit === 'day' ? 'تاریخ شروع را از تقویم انتخاب کنید (یا به‌صورت YYYY-MM-DD تایپ کنید):' : 'تاریخ را از تقویم انتخاب کنید (یا به‌صورت YYYY-MM-DD تایپ کنید):',
    label: unit === 'day' ? 'تاریخ شروع' : 'تاریخ',
    quick: ui.quickDates([0, 1, 2]),
    cancelData: CANCEL,
  });
}

async function askEndDate(bot, chatId, startDate) {
  await ui.askDate(bot, chatId, {
    text: 'تاریخ پایان را از تقویم انتخاب کنید (یا به‌صورت YYYY-MM-DD تایپ کنید):',
    label: 'تاریخ پایان',
    min: startDate,
    quick: [{ text: 'همان روز', date: startDate }, { text: 'روز بعد', date: addDays(startDate, 1) }, { text: '۲ روز بعد', date: addDays(startDate, 2) }],
    cancelData: CANCEL,
  });
}

async function askStartTime(bot, chatId) {
  await ui.askTime(bot, chatId, { text: 'ساعت شروع را انتخاب کنید (یا به‌صورت HH:MM تایپ کنید؛ مثال: 10:15):', label: 'ساعت شروع', cancelData: CANCEL });
}

async function askEndTime(bot, chatId, startTime) {
  await ui.askTime(bot, chatId, { text: 'ساعت پایان را انتخاب کنید (یا به‌صورت HH:MM تایپ کنید):', label: 'ساعت پایان', after: startTime, cancelData: CANCEL });
}

async function askPart(bot, chatId) {
  await bot.sendMessage(chatId, 'کدام بخش روز؟', {
    reply_markup: ui.withNav([[{ text: '🌅 صبح', callback_data: 'leave_part:morning' }, { text: '🌇 عصر', callback_data: 'leave_part:afternoon' }]], { cancelData: CANCEL }),
  });
}

async function askReason(bot, chatId) {
  await ui.askText(bot, chatId, 'توضیح کوتاه بنویسید (یا با دکمه‌ی «رد شدن» ادامه دهید):', { skip: true, cancelData: CANCEL });
}

// خلاصه با مدت و هشدارها؛ خطای قواعد ⇒ پیام خطا و پایان جریان (کاربر از دکمه‌ی منو دوباره شروع می‌کند)
async function sendSummary(bot, chatId, data) {
  const result = leaveService.validate(toServiceInput(data));
  if (!result.ok) {
    session.clear(chatId);
    if (data.attachment) await attachmentService.remove(data.attachment.id); // فایل یتیم نماند
    // E4: به‌جای «دوباره /leave را بفرستید» ⇒ ارجاع به دکمه‌ی منوی پایین (بدون opts: دکمه‌ی اضافه نمی‌گذاریم)
    await bot.sendMessage(chatId, ['❌ این درخواست قابل ثبت نیست:', ...result.errors.map((e) => `• ${e.error}`), '', 'برای شروع دوباره، «🏖 مرخصی / 🚗 ماموریت» را از منوی پایین بزنید.'].join('\n'));
    return;
  }
  const user = usersRepository.findById(data.userId);
  const dayMinutes = leaveBalanceService.workDayMinutesOf(user);
  const unit = data.unit || 'day';
  const when = {
    day: `از: ${result.value.startDate}\nتا: ${result.value.endDate}`,
    half_day: `تاریخ: ${result.value.startDate}\nبخش: ${PART_LABEL[result.value.halfDayPart]}`,
    hour: `تاریخ: ${result.value.startDate}\nاز ساعت: ${result.value.startTime}\nتا ساعت: ${result.value.endTime}`,
  }[unit];
  const lines = [
    'خلاصه درخواست:',
    `نوع: ${result.type.title}`,
    when,
    `مدت: ${formatMinutes(result.durationMinutes, dayMinutes).text}`,
    `توضیح: ${data.reason || '—'}`,
    data.attachment ? `پیوست: ✅ ${data.attachment.name || ''} (${Math.ceil(data.attachment.size / 1024)} کیلوبایت)`.trim() : null,
  ].filter((x) => x !== null);
  if (result.warnings.some((w) => w.code === 'LOW_BALANCE')) lines.push('', '⚠️ مانده‌ی مرخصی شما برای این درخواست کافی نیست؛ ثبت می‌شود ولی ممکن است مدیر رد کند.');
  lines.push('', 'ارسال شود؟');
  session.update(chatId, { step: 4, data });
  await bot.sendMessage(chatId, lines.join('\n'), {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '✅ تأیید و ارسال', callback_data: 'leave_confirm:yes' },
          { text: '❌ انصراف', callback_data: 'leave_confirm:no' },
        ],
        [{ text: '🏠 منوی اصلی', callback_data: ui.CB.HOME }],
      ],
    },
  });
}

// مرحله‌های متنی: ۱ تاریخ شروع، ۲ تاریخ پایان (روزانه)، ۵ ساعت شروع، ۶ ساعت پایان (ساعتی)، ۳ توضیح
async function handleLeaveText(bot, msg, sess) {
  const chatId = msg.chat.id;
  const text = (msg.text || '').trim();
  const unit = sess.data.unit || 'day';

  if (sess.step === 1) {
    if (!isValidDate(text)) {
      await ui.retry(bot, chatId, 'فرمت تاریخ نامعتبر است. تاریخ را از تقویم بالا انتخاب کنید یا به‌صورت YYYY-MM-DD تایپ کنید (مثال: 2026-09-25):', { cancelData: CANCEL });
      return;
    }
    const data = { ...sess.data, startDate: text };
    if (unit === 'day') {
      session.update(chatId, { step: 2, data });
      await askEndDate(bot, chatId, text);
    } else if (unit === 'half_day') {
      session.update(chatId, { step: 7, data: { ...data, endDate: text } });
      await askPart(bot, chatId);
    } else {
      session.update(chatId, { step: 5, data: { ...data, endDate: text } });
      await askStartTime(bot, chatId);
    }
    return;
  }

  if (sess.step === 2) {
    if (!isValidDate(text) || text < sess.data.startDate) {
      await ui.retry(bot, chatId, 'تاریخ پایان نامعتبر است یا قبل از تاریخ شروع است. دوباره انتخاب کنید یا تایپ کنید:', { cancelData: CANCEL });
      return;
    }
    session.update(chatId, { step: 3, data: { ...sess.data, endDate: text } });
    await askReason(bot, chatId);
    return;
  }

  if (sess.step === 5) {
    const t = normalizeTime(text);
    if (!t) {
      await ui.retry(bot, chatId, 'ساعت نامعتبر است. از دکمه‌های بالا انتخاب کنید یا به‌صورت HH:MM تایپ کنید (مثال: 10:00):', { cancelData: CANCEL });
      return;
    }
    session.update(chatId, { step: 6, data: { ...sess.data, startTime: t } });
    await askEndTime(bot, chatId, t);
    return;
  }

  if (sess.step === 6) {
    const t = normalizeTime(text);
    if (!t || t <= sess.data.startTime) {
      await ui.retry(bot, chatId, 'ساعت پایان نامعتبر است یا قبل از ساعت شروع است. دوباره انتخاب کنید یا تایپ کنید (HH:MM):', { cancelData: CANCEL });
      return;
    }
    session.update(chatId, { step: 3, data: { ...sess.data, endTime: t } });
    await askReason(bot, chatId);
    return;
  }

  if (sess.step === 3) {
    const data = { ...sess.data, reason: text === '-' ? null : text };
    // نوعی که پیوست الزامی دارد (S4-12a): قبل از خلاصه فایل می‌خواهیم؛ بقیه‌ی نوع‌ها مثل قبل
    const type = data.leaveTypeId ? leaveTypesRepository.findById(data.leaveTypeId) : null;
    if (type && type.requiresAttachment) {
      session.update(chatId, { step: 9, data });
      await bot.sendMessage(chatId, 'این نوع درخواست پیوست لازم دارد. تصویر (عکس) یا فایل PDF را همین‌جا بفرستید:', {
        reply_markup: ui.withNav([], { cancelData: CANCEL }),
      });
      return;
    }
    await sendSummary(bot, chatId, data);
    return;
  }

  if (sess.step === 9) {
    await ui.retry(bot, chatId, 'لطفاً به‌جای متن، عکس یا فایل PDF بفرستید (یا با دکمه‌ی انصراف خارج شوید).', { cancelData: CANCEL });
  }
}

// دریافت پیوست (S4-12a): عکس یا سند در مرحله‌ی ۹ جریان /leave. نوع/حجم قبل و بعد از دانلود سنجیده می‌شود؛ فایل با نام تصادفی ذخیره می‌شود.
async function handleLeaveAttachment(bot, msg, sess) {
  const chatId = msg.chat.id;
  if (!sess || sess.flow !== 'leave' || sess.step !== 9) return;
  const photo = Array.isArray(msg.photo) && msg.photo.length ? msg.photo[msg.photo.length - 1] : null;
  const doc = msg.document || null;
  const meta = photo
    ? { fileId: photo.file_id, mime: 'image/jpeg', size: photo.file_size, name: null }
    : doc ? { fileId: doc.file_id, mime: doc.mime_type, size: doc.file_size, name: doc.file_name } : null;
  if (!meta || !meta.fileId) return;

  const pre = attachmentService.precheck(meta);
  if (!pre.ok) {
    await bot.sendMessage(chatId, `❌ ${pre.error}`);
    return;
  }
  let saved;
  try {
    saved = await attachmentService.saveStream(bot.getFileStream(meta.fileId), { mime: meta.mime, size: meta.size, originalName: meta.name });
  } catch (err) {
    saved = { ok: false, error: 'دریافت فایل ناموفق بود. دوباره تلاش کنید.' };
  }
  if (!saved.ok) {
    await bot.sendMessage(chatId, `❌ ${saved.error}`);
    return;
  }
  await sendSummary(bot, chatId, { ...sess.data, attachment: saved.attachment });
}

async function chooseUnit(bot, chatId, sess, unit) {
  session.update(chatId, { step: 1, data: { ...sess.data, unit } });
  await askStartDate(bot, chatId, unit);
}

async function handleLeaveCallback(bot, query, sess) {
  const chatId = query.message.chat.id;
  const [action, value] = query.data.split(':');

  // E3: دکمه‌ی مرحله‌ی قدیمی (session نیست یا در مرحله‌ی دیگری است) ⇒ «این دکمه منقضی شده، منو را باز کنید»
  const stepOf = { leave_type: 0, leave_unit: 8, leave_part: 7, leave_confirm: 4 };
  // sessionِ ناقص (بدون flow/step؛ فراخوانی قدیمی/تست) رد نمی‌شود — index.js خودش flow را پیش از صدا زدن چک می‌کند
  const flowBad = !sess || (sess.flow !== undefined && sess.flow !== 'leave');
  const stepBad = sess && sess.step !== undefined && action !== 'leave_cancel' && sess.step !== stepOf[action];
  if (flowBad || stepBad) {
    await ui.expire(bot, query);
    return;
  }

  if (action === 'leave_cancel') {
    if (sess && sess.data && sess.data.attachment) await attachmentService.remove(sess.data.attachment.id);
    session.clear(chatId);
    await bot.answerCallbackQuery(query.id);
    await bot.sendMessage(chatId, 'درخواست لغو شد.');
    return;
  }

  if (action === 'leave_type') {
    await bot.answerCallbackQuery(query.id);
    const type = /^\d+$/.test(value || '') ? leaveTypesRepository.findById(Number(value)) : null;
    if (/^\d+$/.test(value || '') && (!type || !type.isActive)) {
      session.clear(chatId);
      await bot.sendMessage(chatId, 'این نوع درخواست دیگر در دسترس نیست. برای شروع دوباره، «🏖 مرخصی / 🚗 ماموریت» را از منوی پایین بزنید.'); // E4
      return;
    }
    // مقدار قدیمی leave|mission (دکمه‌ی پیام‌های قدیمی): روزانه با leaveType قدیمی
    const base = type ? { ...sess.data, leaveTypeId: type.id, leaveType: type.kind } : { ...sess.data, leaveType: value };
    const units = type ? type.allowedUnits : ['day'];
    if (units.length > 1) {
      session.update(chatId, { step: 8, data: base });
      await bot.sendMessage(chatId, 'واحد درخواست را انتخاب کنید:', {
        reply_markup: ui.withNav([units.map((u) => ({ text: UNIT_LABEL[u], callback_data: `leave_unit:${u}` }))], { cancelData: CANCEL }),
      });
      return;
    }
    await chooseUnit(bot, chatId, { ...sess, data: base }, units[0]);
    return;
  }

  if (action === 'leave_unit') {
    await bot.answerCallbackQuery(query.id);
    if (!UNIT_LABEL[value]) return;
    await chooseUnit(bot, chatId, sess, value);
    return;
  }

  if (action === 'leave_part') {
    await bot.answerCallbackQuery(query.id);
    if (!PART_LABEL[value]) return;
    session.update(chatId, { step: 3, data: { ...sess.data, halfDayPart: value } });
    await askReason(bot, chatId);
    return;
  }

  if (action === 'leave_confirm') {
    await bot.answerCallbackQuery(query.id);
    if (value === 'no') {
      if (sess.data.attachment) await attachmentService.remove(sess.data.attachment.id);
      session.clear(chatId);
      await bot.sendMessage(chatId, 'درخواست لغو شد.');
      return;
    }

    const user = usersRepository.findById(sess.data.userId);
    const result = leaveService.create(toServiceInput(sess.data));
    session.clear(chatId);
    if (!result.ok) {
      if (sess.data.attachment) await attachmentService.remove(sess.data.attachment.id);
      await bot.sendMessage(chatId, ['❌ درخواست ثبت نشد:', ...result.errors.map((e) => `• ${e.error}`)].join('\n'));
      return;
    }
    const { request } = result;
    auditRepository.logEvent({
      userId: user.id,
      action: 'leave_request_created',
      details: { requestId: request.id, leaveType: request.kind, unit: request.unit, durationMinutes: request.duration_minutes, source: 'bot' },
    });
    notificationEvents.leaveRequested(request); // اعلان پنل برای تأییدکننده‌ها (S4-6b)

    await bot.sendMessage(chatId, '✅ درخواست شما ثبت شد و برای تأیید ارسال شد.');
    await notifyApprovers(bot, user, request);
  }
}

module.exports = { handleLeaveCommand, handleLeaveText, handleLeaveCallback, handleLeaveAttachment };
