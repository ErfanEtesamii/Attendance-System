// اسکریپت ساخت/به‌روزرسانی کارمندان بر اساس چارت سازمانی.
// کد پرسنلی: رقم اول = شماره تیم، دو رقم بعد = ردیف در تیم (۰۱ = مدیر بخش).
//
// استفاده:
//   node src/scripts/seedEmployees.js            # فقط پیش‌نمایش (چیزی نوشته نمی‌شود)
//   node src/scripts/seedEmployees.js --apply    # ثبت واقعی در دیتابیس
//
// تکرارپذیر (upsert بر اساس کد پرسنلی): اگر کدی از قبل وجود داشته باشد، نام/بخش/نقش/مدیر
// آن به‌روز می‌شود (آیدی تلگرام و وضعیت فعال/غیرفعال دست‌نخورده می‌ماند).
// آیدی تلگرام بعداً از پنل مدیریتی (ویرایش کارمند) وارد می‌شود.
//
// سطح بالای چارت (خراطی - ترابی - اعتصامی) در سیستم تردد ثبت نمی‌شود.

const usersRepository = require('../repositories/usersRepository');
const { getDb } = require('../db/connection');

const TEAMS = [
  { n: 1, department: 'فروشگاه', manager: 'محمدرضا جمالی',
    members: ['پرنیا خسروی', 'صبا اسماعیلی', 'عبداللهی'] },
  { n: 2, department: 'سایت', manager: 'معصومه صادقی',
    members: ['امیرحسین قاضی', 'مهسا جعفرخالو', 'عبداللهی', 'ملینا پورابراهیم'] },
  { n: 3, department: 'فروش', manager: 'مهتاب مایان',
    members: ['عسل حیدری', 'زهرا حیدریان', 'علی مهذب'] },
  { n: 4, department: 'انبار', manager: 'علیرضا محمدی',
    members: ['ابوذر امینی'] },
  { n: 5, department: 'حسابداری', manager: 'زهرا آقاداوود',
    members: ['هادی حجازی'] },
];

const code = (team, idx) => `${team}${String(idx).padStart(2, '0')}`;
const apply = process.argv.includes('--apply');

function upsert(fields) {
  const existing = usersRepository.listUsers().find((u) => u.personnel_code === fields.personnelCode);
  if (!existing) {
    return { user: apply ? usersRepository.createUser(fields) : null, action: 'جدید' };
  }
  const changed =
    existing.full_name !== fields.fullName ||
    existing.department !== fields.department ||
    existing.role !== fields.role ||
    (existing.manager_id || null) !== (fields.managerId || null);
  if (!changed) return { user: existing, action: 'بدون تغییر' };
  const user = apply
    ? usersRepository.updateUser(existing.id, {
        full_name: fields.fullName,
        department: fields.department,
        role: fields.role,
        manager_id: fields.managerId || null,
      })
    : existing;
  return { user, action: 'به‌روزرسانی' };
}

function main() {
  getDb();
  const stats = { 'جدید': 0, 'به‌روزرسانی': 0, 'بدون تغییر': 0 };

  for (const t of TEAMS) {
    console.log(`\n[بخش ${t.department}]`);

    const m = upsert({
      fullName: t.manager, personnelCode: code(t.n, 1),
      department: t.department, role: 'manager', managerId: null,
    });
    stats[m.action]++;
    console.log(`  ${code(t.n, 1)}  ${t.manager}  (مدیر)  — ${m.action}`);

    t.members.forEach((name, i) => {
      const c = code(t.n, i + 2);
      const r = upsert({
        fullName: name, personnelCode: c, department: t.department,
        role: 'employee', managerId: m.user ? m.user.id : null,
      });
      stats[r.action]++;
      console.log(`  ${c}  ${name}  — ${r.action}`);
    });
  }

  console.log(`\nخلاصه: ${stats['جدید']} جدید، ${stats['به‌روزرسانی']} به‌روزرسانی، ${stats['بدون تغییر']} بدون تغییر.`);
  console.log(apply ? '✅ در دیتابیس ثبت شد.' : '(پیش‌نمایش) چیزی ثبت نشد. برای ثبت: npm run seed-employees -- --apply');
}

main();
