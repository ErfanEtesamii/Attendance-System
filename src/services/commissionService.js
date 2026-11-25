// پورسانت فروش: همگام‌سازی معامله‌های موفق دیدار + محاسبه‌ی پورسانت ماهانه و لیدربرد (مبلغ دیگران هرگز برنمی‌گردد).
'use strict';
const { getDb } = require('../db/connection');
const config = require('../config');
const { dealFromItems, commissionForDeal, nextAmountTier, buildLeaderboards, AMOUNT_TIERS } = require('../utils/commission');
const { jalaliMonthRangeOf, toJalaliFromDate } = require('../utils/jalali');
const didarClient = require('./didarClient');

const tehranDate = (iso) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tehran' }).format(new Date(iso)); // YYYY-MM-DD

function normalizeDeal(d) {
  const email = String((d.Owner && d.Owner.Email) || '').trim().toLowerCase();
  const contact = d.Contact || d.Person || {};
  return {
    didar_id: d.Id, code: d.Code || null, title: String(d.Title || ''), customer: String(contact.DisplayName || '').trim(),
    owner_email: email, owner_name: String((d.Owner && d.Owner.DisplayName) || '').trim(), won_at: d.ChangeToWonTime || '',
    price_rial: Number(d.Price) || 0,
    items_json: JSON.stringify((d.Items || []).map((i) => ({ Title: i.Title, UnitPrice: i.UnitPrice, Quantity: i.Quantity, Discount: i.Discount, DiscountPercent: i.DiscountPercent }))),
  };
}

// جایگزینی کامل کش (چند ده معامله؛ معامله‌ای که دیگر «موفق» نیست خودکار حذف می‌شود)
async function sync({ fetchImpl } = {}) {
  const db = getDb();
  try {
    const rows = (await didarClient.fetchWonDeals({ fetchImpl })).map(normalizeDeal).filter((r) => r.didar_id && r.won_at);
    const ins = db.prepare(`INSERT INTO sales_deals (didar_id, code, title, customer, owner_email, owner_name, won_at, price_rial, items_json) VALUES (@didar_id, @code, @title, @customer, @owner_email, @owner_name, @won_at, @price_rial, @items_json)`);
    db.transaction(() => { db.prepare('DELETE FROM sales_deals').run(); rows.forEach((r) => ins.run(r)); db.prepare("INSERT INTO didar_sync_state (id, last_sync_at, last_error) VALUES (1, datetime('now'), NULL) ON CONFLICT(id) DO UPDATE SET last_sync_at = excluded.last_sync_at, last_error = NULL").run(); })();
    return { ok: true, count: rows.length };
  } catch (err) {
    db.prepare('INSERT INTO didar_sync_state (id, last_error) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET last_error = excluded.last_error').run(String(err.message || err).slice(0, 200));
    return { ok: false, code: err.code || 'DIDAR_ERROR', error: err.message };
  }
}

function syncAgeSeconds() {
  const r = getDb().prepare("SELECT CAST((julianday('now') - julianday(last_sync_at)) * 86400 AS INTEGER) AS age FROM didar_sync_state WHERE id = 1").get();
  return r && r.age != null ? r.age : Infinity;
}
// همگام‌سازی در پس‌زمینه وقتی کش کهنه است (پاسخ فوراً از کش می‌رود)
let inflight = null;
function syncIfStale() {
  if (!config.didar.apiKey || inflight || syncAgeSeconds() < config.didar.syncTtlSeconds) return;
  inflight = sync().finally(() => { inflight = null; });
}

function monthOf(jy, jm) {
  const now = toJalaliFromDate(new Date());
  const y = Number.isInteger(jy) ? jy : now.jy; const m = Number.isInteger(jm) ? jm : now.jm;
  return { jy: y, jm: m, ...jalaliMonthRangeOf(y, m) };
}

const SEASONS = ['بهار', 'تابستان', 'پاییز', 'زمستان'];
// فصل شمسیِ یک ماه: ۳ ماه پشت‌سرهم (بهار = فروردین تا خرداد، ...)
function seasonOf(jy, jm) {
  const s = Math.floor((jm - 1) / 3); const a = jalaliMonthRangeOf(jy, s * 3 + 1); const b = jalaliMonthRangeOf(jy, s * 3 + 3);
  return { from: a.from, to: b.to, label: `${SEASONS[s]} ${jy}` };
}
const ALL_TIME = { from: '0000-01-01', to: '9999-12-31', label: 'از ابتدا' };

// معامله‌های یک بازه‌ی تاریخ (به‌وقت تهران) برای یک ایمیل دیدار؛ هر معامله با پورسانتش
function dealsOfMonth(range, email) {
  const rows = getDb().prepare('SELECT * FROM sales_deals WHERE (? IS NULL OR owner_email = ?) ORDER BY won_at DESC').all(email || null, email || null);
  return rows.filter((r) => { const d = tehranDate(r.won_at); return d >= range.from && d <= range.to; }).map((r) => {
    const items = JSON.parse(r.items_json || '[]');
    const base = { id: r.didar_id, title: r.title || `معامله ${r.code || ''}`.trim(), customer: r.customer, dateLabel: tehranDate(r.won_at), ownerEmail: r.owner_email, hasInvoice: items.length > 0 };
    if (!items.length) return { ...base, amountToman: Math.round(r.price_rial / 10), discountPercent: 0, eligible: false, noInvoice: true, discountRate: 0, amountRate: 0, ratePercent: 0, commissionToman: 0 };
    const d = dealFromItems(items); const c = commissionForDeal(d);
    return { ...base, amountToman: d.amountToman, discountPercent: d.discountPercent, noInvoice: false, ...c };
  });
}

function myCommission(user, { jy, jm } = {}) {
  const range = monthOf(jy, jm);
  const email = String(user.didar_email || '').trim().toLowerCase();
  if (!email) return null;
  const deals = dealsOfMonth(range, email);
  const inv = deals.filter((d) => !d.noInvoice);
  const sales = inv.reduce((t, d) => t + d.amountToman, 0);
  const commission = inv.reduce((t, d) => t + d.commissionToman, 0);
  const best = inv.reduce((m, d) => Math.max(m, d.amountToman), 0);
  const tier = nextAmountTier(best);
  const avg = (f) => (inv.length ? Math.round((inv.reduce((t, d) => t + f(d), 0) / inv.length) * 10) / 10 : 0);
  const seasonRange = seasonOf(range.jy, range.jm);
  const seasonInv = dealsOfMonth(seasonRange, email).filter((d) => !d.noInvoice);
  return {
    monthLabel: range.label,
    season: { label: seasonRange.label, dealsCount: seasonInv.length, commissionToman: seasonInv.reduce((t, d) => t + d.commissionToman, 0) },
    totals: {
      commissionToman: commission, dealsCount: inv.length, noInvoiceCount: deals.length - inv.length, salesToman: sales,
      avgRatePercent: avg((d) => d.ratePercent), avgDiscountPercent: avg((d) => d.discountPercent),
      nextTier: tier ? { rate: tier.rate, remainingToman: Math.max(0, tier.threshold - best + 1), progress: Math.min(100, Math.round((best / tier.threshold) * 100)) } : null,
    },
    deals,
  };
}

// سرپرستِ تیم فروش = مدیرِ مستقیمِ (manager_id) حداقل یک عضو نگاشت‌شده؛ مبلغ اعضای تیم خودش را می‌بیند (admin/owner هم همه را می‌بینند)
function leaderboard(viewer, { jy, jm } = {}) {
  const month = monthOf(jy, jm);
  const periods = { month, season: seasonOf(month.jy, month.jm) };
  const members = getDb().prepare("SELECT id, full_name, didar_email, manager_id, role FROM users WHERE is_active = 1 AND didar_email IS NOT NULL AND didar_email <> '' AND role <> 'owner'").all();
  const isAdmin = ['admin', 'owner'].includes(viewer.role);
  const isSupervisor = members.some((u) => u.manager_id === viewer.id);
  const roleOf = new Map(members.map((u) => [u.id, u]));
  const canSee = (r) => { const u = roleOf.get(r.userId); return isSupervisor && u && u.manager_id === viewer.id; };
  const build = (range) => ({
    label: range.label,
    ...buildLeaderboards(members.map((u) => {
      const inv = dealsOfMonth(range, String(u.didar_email).toLowerCase()).filter((d) => !d.noInvoice);
      return { userId: u.id, name: u.full_name, count: inv.length, amountToman: inv.reduce((t, d) => t + d.amountToman, 0) };
    }), viewer.id, { canSeeAll: isAdmin, canSee }),
  });
  return { monthLabel: month.label, month: build(periods.month), season: build(periods.season), all: isAdmin || isSupervisor ? build(ALL_TIME) : null };
}

module.exports = { sync, syncIfStale, myCommission, leaderboard, normalizeDeal, AMOUNT_TIERS };
