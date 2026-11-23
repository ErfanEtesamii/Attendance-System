// کسر ماهانه‌ی حق بیمه‌ی کارمند (تومان) برای فیش حقوقی. NULL/۰ = بدون کسر. مثل نرخ ساعتی یک داده‌ی حساس است (در SELECT * نمی‌آید).
module.exports = {
  name: '057_insurance_deduction',
  up(db) {
    const cols = new Set(db.prepare("PRAGMA table_info('users')").all().map((c) => c.name));
    if (!cols.has('insurance_deduction_toman')) db.exec('ALTER TABLE users ADD COLUMN insurance_deduction_toman INTEGER NULL CHECK (insurance_deduction_toman IS NULL OR insurance_deduction_toman >= 0);');
  },
};
