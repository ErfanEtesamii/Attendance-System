// پیام‌های تشویقیِ گزارش روزانه (D8).
//
// سه دسته (مجموعاً ≥ ۴۰ جمله، لحن حرفه‌ای و بدون اغراق):
//   simple — تسکِ انجام‌شده‌ی معمولی
//   streak — رگه: چند روز پیاپیِ بدون تسکِ نیمه‌کاره/انجام‌نشده
//   high   — دو حالت (variant): priority = تسک با اولویت بالا · fullDay = تمام‌شدنِ ۱۰۰٪ تسک‌های روز
// متغیرها: {name} (نام کوچک کاربر) و {task} (عنوان تسک؛ در متن داخل «» می‌آید).
//
// «انجام‌نشده» (و «نیمه‌کاره») هرگز تشویق یا قضاوت نمی‌گیرد؛ فقط NOT_DONE_THANKS.
// انتخاب تصادفی است و هیچ جمله‌ای که در ۵ پیام اخیرِ همان کاربر بوده تکرار نمی‌شود.
// متنِ رندرشده در task_daily_logs.encouragement_text ذخیره می‌شود؛ برای تشخیص «کدام قالب بود»
// متنِ ذخیره‌شده دوباره با الگوی هر قالب تطبیق داده می‌شود (نیازی به ستون یا شناسه‌ی اضافه نیست).

const STREAK_MIN = 3; // حداقل روزهای پیاپی برای پیام رگه
const RECENT_WINDOW = 5; // تعداد پیام اخیری که تکرار نمی‌شوند
const NOT_DONE_THANKS = 'ممنون که علتش را نوشتی.';
const TASK_MAX = 60; // عنوان‌های بلند در پیام کوتاه می‌شوند

const SIMPLE = [
  '{name} عزیز، تسک «{task}» به پایان رسید. خسته نباشید.',
  'ثبت شد: «{task}» انجام شد. کار خوبی بود، {name}.',
  '{name}، یک کار دیگر از فهرست شما کم شد: «{task}». ممنون از پیگیری‌تان.',
  'انجام «{task}» ثبت شد. دست شما درد نکند، {name}.',
  'عالی بود {name}! «{task}» هم تمام شد.',
  '{name} عزیز، پیگیری «{task}» به نتیجه رسید. سپاس.',
  '«{task}» انجام شد؛ ممنون که دقیق گزارش دادید.',
  'یک گام دیگر برداشته شد: «{task}». خسته نباشید {name}.',
  '{name}، «{task}» از فهرست کارهای باز خارج شد. ممنون از تلاش‌تان.',
  'کارِ «{task}» تمام شد و این یعنی پیشرفت. مرسی {name}.',
  'خسته نباشید {name}؛ «{task}» با موفقیت ثبت شد.',
  '{name} عزیز، گزارش دقیقِ «{task}» به برنامه‌ریزی تیم کمک می‌کند. ممنون.',
  '«{task}» انجام شد. نظم شما در گزارش‌دهی قابل‌قدردانی است، {name}.',
  '{name}، یکی دیگر از تعهدهای این هفته انجام شد: «{task}». سپاسگزاریم.',
  'دست مریزاد {name}؛ «{task}» به سرانجام رسید.',
  'ممنون {name}؛ «{task}» انجام شد و برنامه‌ی هفته یک قدم جلوتر رفت.',
  '«{task}» تمام شد. روز خوبی داشته باشید {name}.',
  '{name} عزیز، تلاش شما در «{task}» دیده شد. ممنون.',
];

const STREAK = [
  '{name} عزیز، چند روز پیاپی گزارش‌های شما موفق بوده؛ «{task}» هم به این رشته اضافه شد.',
  'رگه‌ی خوب شما ادامه دارد {name}! «{task}» هم انجام شد.',
  '{name}، ثبات شما در انجام کارها ستودنی است. «{task}» تمام شد.',
  'روزهای پیاپی بدون کارِ نیمه‌تمام؛ «{task}» هم تمام شد. عالی است {name}.',
  'پشتکار شما نتیجه می‌دهد، {name}. «{task}» انجام شد و رگه ادامه دارد.',
  '{name} عزیز، این نظم روزانه ارزشمند است. «{task}» هم کامل شد.',
  'زنجیره‌ی روزهای موفق شما بلندتر شد؛ «{task}» ثبت شد. دست مریزاد {name}.',
  '{name}، پیوستگی شما در انجام تسک‌ها برای تیم الگوست. «{task}» انجام شد.',
  '«{task}» هم تمام شد؛ ریتم کاری شما ثابت و قابل‌اتکاست، {name}.',
  '{name}، رگه‌ی انجام تسک‌هایتان حفظ شد. سپاس بابت «{task}».',
  'چند روز است که برنامه را دقیق جلو می‌برید. «{task}» هم تمام شد، {name}.',
  'ادامه‌ی این روند عالی است {name}؛ «{task}» به فهرست انجام‌شده‌ها اضافه شد.',
];

const HIGH_PRIORITY = [
  '{name} عزیز، «{task}» از تسک‌های مهم بود و انجامش ارزشمند است. سپاس.',
  'کار مهمی را تمام کردید: «{task}». خسته نباشید {name}.',
  '{name}، یک تسک با اولویت بالا به پایان رسید: «{task}». دست شما درد نکند.',
  '«{task}» با اولویت بالا انجام شد؛ ممنون که روی مهم‌ترین‌ها تمرکز کردید، {name}.',
  '{name}، انجام «{task}» اثر مهمی در پیشرفت تیم دارد. ممنون از شما.',
  'تسک حساسی مثل «{task}» را به نتیجه رساندید؛ عالی است {name}.',
];

const FULL_DAY = [
  '{name} عزیز، همه‌ی تسک‌های امروز انجام شد؛ روزی صددرصدی! خسته نباشید.',
  'صددرصد! با «{task}» فهرست امروز شما کامل شد، {name}.',
  '{name}، امروز هیچ کاری باز نماند؛ «{task}» آخرین تسک بود. عالی!',
  'روزی کامل و بدون تسک باز؛ دست شما درد نکند {name}.',
  'با ثبت «{task}»، برنامه‌ی امروز به‌طور کامل اجرا شد. تبریک {name}!',
  '{name} عزیز، امروز را صددرصد بستید. ممنون از تعهد و نظم‌تان.',
];

const TEMPLATES = { simple: SIMPLE, streak: STREAK, high: { priority: HIGH_PRIORITY, fullDay: FULL_DAY } };
const POOLS = { simple: SIMPLE, streak: STREAK, 'high:priority': HIGH_PRIORITY, 'high:fullDay': FULL_DAY };
const ALL = [...SIMPLE, ...STREAK, ...HIGH_PRIORITY, ...FULL_DAY];

const escapeRe = (s) => s.replace(/[.*+?^${}()[\]\\|]/g, '\\$&');
// هر قالب ⇒ الگوی تطبیق با متنِ رندرشده ({name}/{task} ⇒ هر چیزی)
const MATCHERS = ALL.map((t) => new RegExp(`^${escapeRe(t).replace(/\\\{(?:name|task)\\\}/g, '.+?')}$`, 'u'));

/** نامِ کوچک (کلمه‌ی اول)؛ خالی ⇒ «همکار». */
function firstName(fullName) {
  const n = String(fullName == null ? '' : fullName).replace(/[\u200c\u200f\u200e]+$/g, '').trim().split(/\s+/)[0];
  return n || 'همکار';
}

function shortTask(task) {
  const t = String(task == null ? '' : task).replace(/\s+/g, ' ').trim();
  return t.length > TASK_MAX ? `${t.slice(0, TASK_MAX - 1).trimEnd()}…` : t;
}

/** جایگذاری متغیرها در یک گذر (مقدارِ جایگذاری‌شده دوباره پردازش نمی‌شود). */
function render(template, { name, task } = {}) {
  const vars = { name: firstName(name), task: shortTask(task) };
  return template.replace(/\{(name|task)\}/g, (_, k) => vars[k]);
}

/** شماره‌ی قالبِ یک متنِ ذخیره‌شده در ALL؛ ناشناخته ⇒ -1. */
function templateIndexOf(text) {
  const s = String(text == null ? '' : text);
  return MATCHERS.findIndex((re) => re.test(s));
}

function poolOf(category, variant) {
  if (category === 'high') return variant === 'fullDay' ? FULL_DAY : HIGH_PRIORITY;
  return POOLS[category] || SIMPLE;
}

/**
 * انتخاب تصادفیِ یک پیام. recent: متن‌های اخیرِ همان کاربر (جدیدترین اول)؛ فقط ۵ تای اول حساب می‌شود.
 * rng برای تست تزریق‌پذیر است (پیش‌فرض Math.random).
 */
function pickEncouragement({ category = 'simple', variant, name, task, recent = [], rng = Math.random } = {}) {
  const pool = poolOf(category, variant);
  const blocked = new Set(recent.slice(0, RECENT_WINDOW).map(templateIndexOf).filter((i) => i >= 0));
  let candidates = pool.filter((t) => !blocked.has(ALL.indexOf(t)));
  if (!candidates.length) candidates = pool; // نباید پیش بیاید (هر استخر > ۵ قالب دارد)؛ محافظ
  const idx = Math.min(candidates.length - 1, Math.floor(rng() * candidates.length));
  return render(candidates[idx], { name, task });
}

/** پیامِ یک پاسخ: done ⇒ تشویق؛ partial/not_done ⇒ فقط تشکرِ ثابت (بدون قضاوت). */
function encouragementFor({ status, category, variant, name, task, recent, rng } = {}) {
  if (status === 'done') return pickEncouragement({ category, variant, name, task, recent, rng });
  if (status === 'partial' || status === 'not_done') return NOT_DONE_THANKS;
  return null;
}

module.exports = {
  TEMPLATES, ALL, STREAK_MIN, RECENT_WINDOW, NOT_DONE_THANKS,
  firstName, render, templateIndexOf, pickEncouragement, encouragementFor,
};
