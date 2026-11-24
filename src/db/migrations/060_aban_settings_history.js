// تثبیت تاریخچه‌ی واقعی قواعد از ۱ آبان ۱۴۰۵: تا ۲۶ آبان (۲۰۲۶-۱۱-۱۷) ناهارِ ثابت صفر (فقط ناهارِ ثبت‌شده کم می‌شود)
// و سقف استراحت با حقوق ۴۵ دقیقه؛ از ۲۷ آبان (۲۰۲۶-۱۱-۱۸) ناهار ثابت ۴۵ دقیقه (متناسب با حضور) و استراحت با حقوق ۲۰ دقیقه.
module.exports = {
  name: '060_aban_settings_history',
  up(db) {
    // فقط دیتابیسی که داده‌ی آبان دارد (نصب تازه/تست بدون رکورد، دست‌نخورده می‌ماند)
    const has = db.prepare("SELECT 1 FROM attendance_records WHERE record_date BETWEEN '2026-10-23' AND '2026-11-17' LIMIT 1").get();
    if (!has) return;
    const ins = db.prepare('INSERT OR REPLACE INTO settings_history (key, effective_from, value) VALUES (?, ?, ?)');
    for (const [k, from, v] of [
      ['fixedLunchDeductMinutes', '0000-00-00', '0'], ['fixedLunchDeductMinutes', '2026-11-18', '45'],
      ['fixedLunchProRate', '0000-00-00', '0'], ['fixedLunchProRate', '2026-11-18', '1'],
      ['paidBreakMinutes', '0000-00-00', '45'], ['paidBreakMinutes', '2026-11-18', '20'],
    ]) ins.run(k, from, v);
  },
};
