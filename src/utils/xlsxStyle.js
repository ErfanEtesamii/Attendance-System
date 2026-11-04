// استایل مشترک خروجی‌های xlsx (پالت پنل: سرمه‌ای + نارنجی). هم buildWorkbook و هم نسخه‌ی streaming از همین‌جا استفاده می‌کنند.
// همه‌ی فراخوانی‌ها دفاعی‌اند (روی exceljs ساختگی در تست‌ها هم نمی‌شکنند) و فقط ظاهر را عوض می‌کنند، نه داده را.

const COLORS = {
  navy: 'FF1F3A5F',
  navyDark: 'FF162B47',
  orange: 'FFF28C28',
  white: 'FFFFFFFF',
  zebra: 'FFF3F6FA',
  border: 'FFD5DCE6',
  text: 'FF1B2A41',
};
const TAB_COLORS = ['FF1F3A5F', 'FFF28C28', 'FF2E8B7A', 'FF6C5CE7', 'FFC0392B', 'FF3B82C4'];
const FONT_NAME = 'Tahoma';

const thin = (argb) => ({ style: 'thin', color: { argb } });
const BODY_BORDER = { top: thin(COLORS.border), bottom: thin(COLORS.border), left: thin(COLORS.border), right: thin(COLORS.border) };
const HEAD_BORDER = { top: thin(COLORS.navyDark), left: thin(COLORS.navyDark), right: thin(COLORS.navyDark), bottom: { style: 'medium', color: { argb: COLORS.orange } } };

// نوع ستون از روی داده: عددی ⇒ وسط‌چین؛ متن کوتاه ⇒ وسط‌چین؛ متن بلند ⇒ راست‌چین با شکستن خط
function columnKinds(headers, rows) {
  return headers.map((_, i) => {
    let numeric = true; let any = false; let maxLen = 0;
    for (const r of rows) {
      const v = r[i];
      if (v === null || v === undefined || v === '') continue;
      any = true;
      if (typeof v !== 'number') numeric = false;
      maxLen = Math.max(maxLen, v instanceof Date ? 16 : String(v).length);
    }
    if (any && numeric) return 'number';
    return maxLen > 24 ? 'longtext' : 'text';
  });
}

function alignmentOf(kind) {
  if (kind === 'longtext') return { vertical: 'middle', horizontal: 'right', wrapText: true, readingOrder: 'rtl' };
  return { vertical: 'middle', horizontal: 'center', wrapText: true };
}

function styleHeader(head) {
  head.font = { name: FONT_NAME, bold: true, size: 11, color: { argb: COLORS.white } };
  head.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  head.height = 30;
  if (typeof head.eachCell === 'function') {
    head.eachCell((c) => {
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.navy } };
      c.border = HEAD_BORDER;
    });
  }
}

/** استایل یک ردیف داده؛ index از صفر (برای راه‌راه‌کردن). */
function styleBodyRow(row, index, kinds) {
  if (typeof row.eachCell !== 'function') return;
  const zebra = index % 2 === 1;
  row.eachCell({ includeEmpty: true }, (c, col) => {
    c.font = { name: FONT_NAME, size: 10.5, color: { argb: COLORS.text } };
    c.alignment = alignmentOf(kinds[col - 1] || 'text');
    c.border = BODY_BORDER;
    if (zebra) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.zebra } };
  });
}

/** گزینه‌های سطح شیت برای addWorksheet: رنگ تب، چاپ افقی و جاگیری در عرض یک صفحه (به views دست نمی‌زند). */
function sheetOptions(sheetIndex) {
  return {
    properties: { tabColor: { argb: TAB_COLORS[sheetIndex % TAB_COLORS.length] }, defaultRowHeight: 20 },
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9, horizontalCentered: true },
  };
}

module.exports = { COLORS, FONT_NAME, columnKinds, styleHeader, styleBodyRow, sheetOptions };
