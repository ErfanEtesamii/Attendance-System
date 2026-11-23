// تنظیمات محاسباتی تاریخ‌دار (خالص). history: { کلید: [{ from: 'YYYY-MM-DD'، value }] } مرتب‌شده بر اساس from صعودی.
// settingsAt(settings, dateStr): همان settings ولی با مقدار مؤثر هر کلیدِ تاریخ‌دار در «dateStr»؛ روز قبل از اولین ردیف ⇒ مقدار فعلی.
// فقط کلیدهایی که روی محاسبه‌ی ساعت مفید اثر می‌گذارند ردیابی می‌شوند.

const TRACKED = [
  'paidBreakCount', 'paidBreakCountUnlimited', 'paidBreakMinutes',
  'maxLunchMinutes', 'fixedLunchDeductMinutes', 'fixedLunchMode', 'lunchWindowStart', 'lunchWindowEnd',
  'fixedLunchMinOverlapMinutes', 'fixedLunchProRate', 'fixedLunchMinPresenceMinutes',
  'lateGraceMinutes', 'earlyGraceMinutes',
];
const BASE_FROM = '0000-00-00';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isTracked(key) { return TRACKED.includes(key); }

function settingsAt(settings, dateStr) {
  const h = settings && settings.__history;
  if (!h || typeof dateStr !== 'string' || !DATE_RE.test(dateStr)) return settings;
  let out = null;
  for (const key of Object.keys(h)) {
    let pick;
    for (const e of h[key]) { if (e.from <= dateStr) pick = e; else break; }
    if (pick) { if (!out) out = { ...settings }; out[key] = pick.value; }
  }
  return out || settings;
}

module.exports = { TRACKED, BASE_FROM, DATE_RE, isTracked, settingsAt };
