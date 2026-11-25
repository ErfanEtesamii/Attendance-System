// خروجی اکسل پورسانت برای حسابداری: «خلاصه‌ی اعضا» (هر نفر یک ردیف) + «معامله‌ها» (ریز هر فاکتور با درصد و پورسانتش).
// فقط برای ادمین/مالک/سرپرستِ تیم فروش (canViewTeam)؛ اعضای فعال + کارشناسان سابقِ دارای معامله.
'use strict';
const service = require('./commissionService');
const { jalaliPartsOfDateString } = require('../utils/jalali');

const fa = (s) => String(s).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);
const jdate = (iso) => { const j = jalaliPartsOfDateString(iso); return j ? fa(`${j.jy}/${String(j.jm).padStart(2, '0')}/${String(j.jd).padStart(2, '0')}`) : iso; };
const statusOf = (d) => (d.noInvoice ? 'بدون فاکتور' : (d.eligible ? 'مشمول پورسانت' : 'تخفیف بیش از حد مجاز'));

function owners(viewer) {
  const active = service.visibleMembers(viewer).map((u) => ({ key: String(u.didar_email).toLowerCase(), name: u.full_name, former: false }));
  const former = service.formerOwners().map((f) => ({ key: f.key, name: f.name, former: true }));
  return [...active, ...former];
}

// ⇒ { ok, range, sheets } | { ok:false, status, error, code }
function buildCommissionSheets(viewer, q = {}) {
  if (!service.canViewTeam(viewer)) return { ok: false, status: 403, error: 'این خروجی مخصوص ادمین/مالک و سرپرست تیم فروش است.', code: 'FORBIDDEN' };
  const range = service.rangeOf(q);
  const summary = []; const detail = [];
  for (const o of owners(viewer)) {
    const deals = service.dealsOfMonth(range, o.key);
    if (!deals.length) continue;
    const inv = deals.filter((d) => !d.noInvoice);
    const sales = inv.reduce((t, d) => t + d.amountToman, 0);
    const commission = inv.reduce((t, d) => t + d.commissionToman, 0);
    const avg = (f) => (inv.length ? Math.round((inv.reduce((t, d) => t + f(d), 0) / inv.length) * 10) / 10 : 0);
    summary.push([o.name, o.former ? 'سابق' : 'فعال', inv.length, sales, commission, avg((d) => d.ratePercent), avg((d) => d.discountPercent), deals.length - inv.length]);
    for (const d of deals.slice().sort((a, b) => a.dateLabel.localeCompare(b.dateLabel))) {
      detail.push([jdate(d.dateLabel), d.dateLabel, o.name, d.customer || '', d.title || '', d.noInvoice ? 0 : d.amountToman, d.noInvoice ? '' : d.discountPercent, d.noInvoice ? '' : d.ratePercent, d.noInvoice ? 0 : d.commissionToman, statusOf(d)]);
    }
  }
  summary.sort((a, b) => b[4] - a[4]);
  const total = summary.reduce((t, r) => [t[0] + r[2], t[1] + r[3], t[2] + r[4]], [0, 0, 0]);
  summary.push(['جمع کل', '', total[0], total[1], total[2], '', '', '']);
  const title = `پورسانت تیم فروش — ${range.label}`;
  const sheets = [
    { name: 'خلاصه‌ی اعضا', headers: ['نام', 'وضعیت', 'تعداد فاکتور', 'جمع فروش (تومان)', 'جمع پورسانت (تومان)', 'میانگین درصد پورسانت', 'میانگین تخفیف (٪)', 'معامله‌ی بدون فاکتور'], rows: summary },
    { name: 'معامله‌ها', headers: ['تاریخ شمسی', 'تاریخ میلادی', 'کارشناس', 'مشتری', 'عنوان معامله', 'مبلغ فاکتور (تومان)', 'تخفیف (٪)', 'درصد پورسانت', 'پورسانت (تومان)', 'وضعیت'], rows: detail },
  ];
  return { ok: true, title, range, sheets, csv: sheets[1] };
}

module.exports = { buildCommissionSheets };
