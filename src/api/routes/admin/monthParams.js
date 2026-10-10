// اعتبارسنجی مشترک سال/ماه شمسی در routeهای بستن ماه (پیام و کدها مثل گزارش ماهانه: INVALID_YEAR / INVALID_MONTH).

const INVALID_YEAR = { error: 'سال شمسی (year) الزامی و باید ۴ رقمی معتبر باشد.', code: 'INVALID_YEAR' };
const INVALID_MONTH = { error: 'ماه شمسی (month) الزامی و باید بین ۱ تا ۱۲ باشد.', code: 'INVALID_MONTH' };

function parseYear(raw) {
  const year = /^\d{4}$/.test(String(raw === undefined ? '' : raw)) ? parseInt(raw, 10) : NaN;
  if (!Number.isInteger(year) || year < 1300 || year > 1500) return { error: INVALID_YEAR };
  return { year };
}

function parseYearMonth(rawYear, rawMonth) {
  const y = parseYear(rawYear);
  if (y.error) return y;
  const month = /^\d{1,2}$/.test(String(rawMonth === undefined ? '' : rawMonth)) ? parseInt(rawMonth, 10) : NaN;
  if (!Number.isInteger(month) || month < 1 || month > 12) return { error: INVALID_MONTH };
  return { year: y.year, month };
}

module.exports = { parseYear, parseYearMonth };
