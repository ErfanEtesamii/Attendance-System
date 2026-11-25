// پورسانت فروش (آیین‌نامه‌ی پورسانت): درصد پورسانتِ هر معامله‌ی موفق = جمع «درصد بر اساس تخفیف» و «درصد بر اساس مبلغ فاکتور».
// تخفیف بیش از ۳۰٪ ⇒ پورسانت عادی ندارد (ماده‌ی ۵؛ پاداش ویژه فقط با تأیید مدیریت و دستی). مبلغ‌ها به تومان.
'use strict';

const DISCOUNT_TIERS = [ // [سقف درصد تخفیف (شامل), درصد پورسانت]
  [0, 5], [7, 4], [15, 3], [23, 2], [30, 1],
];
const AMOUNT_TIERS = [ // [سقف مبلغ فاکتور (شامل), درصد پورسانت]
  [150_000_000, 1], [250_000_000, 2], [350_000_000, 3], [450_000_000, 4], [Infinity, 5],
];
const MAX_DISCOUNT_PERCENT = 30;

function discountRate(discountPercent) {
  const d = Math.max(0, Number(discountPercent) || 0);
  if (d > MAX_DISCOUNT_PERCENT) return 0;
  if (d === 0) return 5;
  for (const [cap, rate] of DISCOUNT_TIERS) if (cap > 0 && d < cap + 1) return rate; // ۷٫۵٪ هنوز در «۱ تا ۷» نیست ولی در بازه‌ی ۸ تا ۱۵ می‌افتد
  return 0;
}

function amountRate(amountToman) {
  const a = Math.max(0, Number(amountToman) || 0);
  for (const [cap, rate] of AMOUNT_TIERS) if (a <= cap) return rate;
  return 5;
}

// deal: { amountToman, discountPercent } ⇒ { eligible, discountRate, amountRate, ratePercent, commissionToman }
function commissionForDeal({ amountToman, discountPercent }) {
  const dr = discountRate(discountPercent);
  const eligible = (Number(discountPercent) || 0) <= MAX_DISCOUNT_PERCENT;
  const ar = eligible ? amountRate(amountToman) : 0;
  const ratePercent = eligible ? dr + ar : 0;
  return { eligible, discountRate: dr, amountRate: ar, ratePercent, commissionToman: Math.round((Number(amountToman) || 0) * ratePercent / 100) };
}

// سطح بعدیِ مبلغ فاکتور (برای نوار «تا پله‌ی بعد»)؛ null یعنی در بالاترین پله است.
function nextAmountTier(amountToman) {
  const a = Math.max(0, Number(amountToman) || 0);
  for (let i = 0; i < AMOUNT_TIERS.length - 1; i += 1) if (a <= AMOUNT_TIERS[i][0]) return { threshold: AMOUNT_TIERS[i][0], rate: AMOUNT_TIERS[i + 1][1] };
  return null;
}

// لیدربرد تیم فروش: رتبه‌ها برای همه، ولی «مبلغ» فقط برای خودِ شخص یا کسی که canSee(row) اجازه می‌دهد به پاسخ می‌رود؛ مبلغ بقیه هرگز از سرور خارج نمی‌شود.
// rows: [{ userId, name, count, amountToman }]
function buildLeaderboards(rows, viewerId, { canSeeAll = false, canSee = null } = {}) {
  const rank = (list, key) => [...list].sort((a, b) => b[key] - a[key] || String(a.name).localeCompare(String(b.name), 'fa')).map((r, i) => ({ r, rank: i + 1 }));
  const mine = (id) => Number(id) === Number(viewerId);
  const visible = (r) => canSeeAll || mine(r.userId) || (typeof canSee === 'function' && canSee(r));
  return {
    byCount: rank(rows, 'count').map(({ r, rank: n }) => ({ userId: r.userId, name: r.name, rank: n, count: r.count, isMe: mine(r.userId) })),
    byAmount: rank(rows, 'amountToman').map(({ r, rank: n }) => ({ userId: r.userId, name: r.name, rank: n, isMe: mine(r.userId), amountToman: visible(r) ? r.amountToman : null })),
  };
}

// تخفیف در دیدار روی «ردیف‌های فاکتور» (DealItems) زده می‌شود: هر ردیف یا مبلغ (Discount) یا درصد (DiscountPercent) دارد، و مبالغ دیدار «ریال» است.
// درصد تخفیف معامله = مجموع تخفیف ردیف‌ها ÷ مجموع مبلغ ردیف‌ها پیش از تخفیف؛ مبلغ فاکتور (برای پله‌ی مبلغ) = مجموع پس از تخفیف، به تومان.
// ردیف‌های غیرکالایی (پیش‌فرض «هزینه ارسال») در هیچ‌کدام حساب نمی‌شوند.
const RIAL_PER_TOMAN = 10;
const DEFAULT_EXCLUDE_TITLES = ['هزینه ارسال'];

function dealFromItems(items, { excludeTitles = DEFAULT_EXCLUDE_TITLES } = {}) {
  let gross = 0; let discount = 0;
  for (const it of items || []) {
    if (excludeTitles.some((t) => String(it.Title || '').includes(t))) continue;
    const line = (Number(it.UnitPrice) || 0) * (Number(it.Quantity) || 0);
    const byAmount = Number(it.Discount) || 0;
    const d = byAmount > 0 ? byAmount : line * (Number(it.DiscountPercent) || 0) / 100;
    gross += line; discount += Math.min(d, line);
  }
  const grossToman = gross / RIAL_PER_TOMAN;
  return { grossToman, discountToman: discount / RIAL_PER_TOMAN, amountToman: Math.round((gross - discount) / RIAL_PER_TOMAN), discountPercent: gross > 0 ? Math.round((discount / gross) * 1000) / 10 : 0 };
}

module.exports = { dealFromItems, buildLeaderboards, commissionForDeal, discountRate, amountRate, nextAmountTier, DISCOUNT_TIERS, AMOUNT_TIERS, MAX_DISCOUNT_PERCENT };
