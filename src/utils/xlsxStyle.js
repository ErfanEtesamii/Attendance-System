// استایل مشترک خروجی‌های xlsx (پالت پنل: سرمه‌ای + نارنجی). هم buildWorkbook و هم نسخه‌ی streaming از همین‌جا استفاده می‌کنند.
// همه‌ی فراخوانی‌ها دفاعی‌اند (روی exceljs ساختگی در تست‌ها هم نمی‌شکنند) و فقط ظاهر را عوض می‌کنند، نه داده را.

const COLORS = {
  head: 'FF77933C',   // سبز زیتونی سرستون (مطابق نمونه‌ی employees.xlsx)
  white: 'FFFFFFFF',
  zebra: 'FFF3F6FA',
  border: 'FF000000',
  text: 'FF1B2A41',
};
const TAB_COLORS = ['FF1F3A5F', 'FFF28C28', 'FF2E8B7A', 'FF6C5CE7', 'FFC0392B', 'FF3B82C4'];
const FONT_NAME = 'B Nazanin';
const FONT_CHARSET = 178; // Arabic/Persian

const thin = () => ({ style: 'thin', color: { argb: COLORS.border } });
const BORDER = { top: thin(), bottom: thin(), left: thin(), right: thin() };
const ALIGN = { vertical: 'middle', horizontal: 'center', wrapText: true };

// پارامتر نوع ستون دیگر روی ظاهر اثر ندارد (همه‌جا وسط‌چین)؛ برای سازگاری امضا نگه داشته شده
function columnKinds(headers, rows) {
  void rows;
  return headers.map(() => 'text');
}

function styleHeader(head) {
  head.font = { name: FONT_NAME, charset: FONT_CHARSET, bold: true, size: 14, color: { argb: COLORS.white } };
  head.alignment = ALIGN;
  head.height = 30;
  if (typeof head.eachCell === 'function') {
    head.eachCell((c) => {
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.head } };
      c.border = BORDER;
    });
  }
}

/** استایل یک ردیف داده؛ index از صفر (برای راه‌راه‌کردن). */
function styleBodyRow(row, index) {
  if (typeof row.eachCell !== 'function') return;
  const zebra = index % 2 === 1;
  row.eachCell({ includeEmpty: true }, (c) => {
    c.font = { name: FONT_NAME, charset: FONT_CHARSET, size: 12, color: { argb: COLORS.text } };
    c.alignment = ALIGN;
    c.border = BORDER;
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
