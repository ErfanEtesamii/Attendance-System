// نرمال‌سازی ساعتِ تایپ‌شده (H4) — همان منطق ورودی ساعت پنل (public-admin/js/timeinput.js) تا بات و پنل یکسان رفتار کنند:
// ارقام فارسی/عربی، «1530»، «15.30»، «15:3» ⇒ «HH:MM»؛ ساعت ۰–۲۳، دقیقه ۰–۵۹.
const TI = require('../../public-admin/js/timeinput.js');

/** ⇒ { ok:true, value:'HH:MM' } | { ok:false, empty?:true, error:'<پیام فارسی>' } */
const parse = (text) => TI.parse(text);

/** ⇒ 'HH:MM' یا null */
function normalizeTime(text) {
  const r = TI.parse(text);
  return r.ok ? r.value : null;
}

module.exports = { parse, normalizeTime, toLatinDigits: TI.toLatinDigits };
