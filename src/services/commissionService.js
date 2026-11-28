// پورسانت فروش: همگام‌سازی معامله‌های موفق دیدار + محاسبه‌ی پورسانت ماهانه و لیدربرد (مبلغ دیگران هرگز برنمی‌گردد).
'use strict';
const { getDb } = require('../db/connection');
const config = require('../config');
const { dealFromItems, commissionForDeal, nextAmountTier, buildLeaderboards, AMOUNT_TIERS } = require('../utils/commission');
const { jalaliMonthRangeOf, toJalaliFromDate, jalaliPartsOfDateString, MONTH_NAMES } = require('../utils/jalali');
const didarClient = require('./didarClient');
const salesTargets = require('../repositories/salesTargetsRepository');
const { pickMotivation } = require('../utils/motivation');

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
async function sync({ fetchImpl, announce = true } = {}) {
  const db = getDb();
  try {
    const rows = (await didarClient.fetchWonDeals({ fetchImpl })).map(normalizeDeal).filter((r) => r.didar_id && r.won_at);
    const ins = db.prepare(`INSERT INTO sales_deals (didar_id, code, title, customer, owner_email, owner_name, won_at, price_rial, items_json) VALUES (@didar_id, @code, @title, @customer, @owner_email, @owner_name, @won_at, @price_rial, @items_json)`);
    db.transaction(() => { db.prepare('DELETE FROM sales_deals').run(); rows.forEach((r) => ins.run(r)); db.prepare("INSERT INTO didar_sync_state (id, last_sync_at, last_error) VALUES (1, datetime('now'), NULL) ON CONFLICT(id) DO UPDATE SET last_sync_at = excluded.last_sync_at, last_error = NULL").run(); })();
    if (announce) try { require('./salesNotifyService').announceNewDeals().catch((e) => console.error('[sales-notify]', e.message)); } catch (e) { console.error('[sales-notify]', e.message); }
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

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const jlabel = (iso) => { const j = jalaliPartsOfDateString(iso); return j ? `${j.jd} ${MONTH_NAMES[j.jm - 1]} ${j.jy}` : iso; };
// بازه‌ی دلخواه (from/to میلادی) یا ماه (jy/jm)؛ بازه‌ی نامعتبر ⇒ ماه جاری. viewer غیرمجاز به «کل زمان» حداکثر از ابتدای ماهِ قبلِ ابتدای فصل جاری عقب نمی‌رود.
function rangeOf({ jy, jm, from, to } = {}, { floor = null } = {}) {
  if (ISO.test(String(from || '')) && ISO.test(String(to || '')) && jalaliPartsOfDateString(from) && jalaliPartsOfDateString(to) && from <= to) {
    let f = from;
    if (floor && f < floor) f = floor;
    if (f > to) return { ...monthOf(), custom: false };
    return { from: f, to, label: f === to ? jlabel(f) : `${jlabel(f)} تا ${jlabel(to)}`, custom: true, clamped: f !== from };
  }
  const m = monthOf(jy, jm);
  if (floor && m.to < floor) return { ...monthOf(), custom: false, clamped: true }; // ماهِ قدیمی‌تر از کف ⇒ ماه جاری
  return { ...m, custom: false };
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
  // کلید مالک: ایمیل؛ یا «name:نام» برای معامله‌ای که دیدار ایمیل مالکش را برنمی‌گرداند (کاربر غیرفعال)
  const byName = String(email || '').startsWith('name:');
  const rows = getDb().prepare('SELECT * FROM sales_deals ORDER BY won_at DESC').all()
    .filter((r) => !email || (byName ? (!r.owner_email && r.owner_name === email.slice(5)) : r.owner_email === email));
  return rows.filter((r) => { const d = tehranDate(r.won_at); return d >= range.from && d <= range.to; }).map((r) => {
    const items = JSON.parse(r.items_json || '[]');
    const base = { id: r.didar_id, title: r.title || `معامله ${r.code || ''}`.trim(), customer: r.customer, dateLabel: tehranDate(r.won_at), ownerEmail: r.owner_email, hasInvoice: items.length > 0 };
    if (!items.length) return { ...base, amountToman: Math.round(r.price_rial / 10), discountPercent: 0, eligible: false, noInvoice: true, discountRate: 0, amountRate: 0, ratePercent: 0, commissionToman: 0 };
    const d = dealFromItems(items); const c = commissionForDeal(d);
    return { ...base, amountToman: d.amountToman, discountPercent: d.discountPercent, noInvoice: false, ...c };
  });
}


// ---------- هدف فروش ماهانه ----------
// ماهِ هدف: اگر بازه کاملاً داخل یک ماه شمسی باشد همان ماه؛ در غیر این‌صورت (فصل/کل زمان/چند ماه) هدفی نشان داده نمی‌شود.
function targetMonthOf(range) {
  const a = jalaliPartsOfDateString(range.from); const b = jalaliPartsOfDateString(range.to);
  return a && b && a.jy === b.jy && a.jm === b.jm ? { jy: a.jy, jm: a.jm, label: `${MONTH_NAMES[a.jm - 1]} ${a.jy}` } : null;
}
// پیشرفت تا هدف: جمع فروش (مبلغ فاکتور) کل همان ماه شمسی؛ برای کاربری که هدف ندارد null
function targetInfo(userId, email, tm) {
  if (!userId || !tm) return null;
  const t = salesTargets.find(userId, tm.jy, tm.jm);
  if (!t) return null;
  const sales = dealsOfMonth(monthOf(tm.jy, tm.jm), email).filter((d) => !d.noInvoice).reduce((s, d) => s + d.amountToman, 0);
  const progress = Math.min(100, Math.floor((sales / t.target_toman) * 100));
  return {
    jy: tm.jy, jm: tm.jm, monthLabel: `${MONTH_NAMES[tm.jm - 1]} ${tm.jy}`,
    targetToman: t.target_toman, rewardToman: t.reward_toman, rewardNote: t.reward_note || '', rewardText: t.reward_note || pickMotivation(userId, tm.jy, tm.jm),
    salesToman: sales, remainingToman: Math.max(0, t.target_toman - sales), progress, achieved: sales >= t.target_toman,
  };
}

// تشویقیِ هدفِ یک ماه شمسی: فقط وقتی کارمند به هدف رسیده باشد به پورسانتِ همان ماه اضافه می‌شود (۰ وگرنه)
function achievedRewardToman(userId, email, jy, jm) {
  const g = targetInfo(userId, email, { jy, jm });
  return g && g.achieved ? g.rewardToman : 0;
}

// جمع تشویقیِ هدف‌های رسیده‌ی سه ماهِ فصلِ این ماه (برای «پورسانت فصل»)
function seasonRewards(userId, email, jy, jm) {
  if (!userId) return 0;
  const first = Math.floor((jm - 1) / 3) * 3 + 1;
  let sum = 0;
  for (let m = first; m < first + 3; m += 1) sum += achievedRewardToman(userId, email, jy, m);
  return sum;
}

function myCommission(user, q = {}, { floor = null } = {}) {
  const range = rangeOf(q, { floor });
  const email = String(user.didar_email || '').trim().toLowerCase();
  if (!email) return null;
  const deals = dealsOfMonth(range, email);
  const inv = deals.filter((d) => !d.noInvoice);
  const sales = inv.reduce((t, d) => t + d.amountToman, 0);
  const dealsCommission = inv.reduce((t, d) => t + d.commissionToman, 0);
  const tm = targetMonthOf(range);
  const target = targetInfo(user.id, email, tm);
  const rewardToman = target && target.achieved ? target.rewardToman : 0; // تشویقیِ هدف به پورسانتِ همان ماه اضافه می‌شود
  const commission = dealsCommission + rewardToman;
  const best = inv.reduce((m, d) => Math.max(m, d.amountToman), 0);
  const tier = nextAmountTier(best);
  const avg = (f) => (inv.length ? Math.round((inv.reduce((t, d) => t + f(d), 0) / inv.length) * 10) / 10 : 0);
  const seasonRange = range.custom ? range : seasonOf(range.jy, range.jm);
  const seasonInv = dealsOfMonth(seasonRange, email).filter((d) => !d.noInvoice);
  return {
    monthLabel: range.label,
    range: { from: range.from, to: range.to, custom: !!range.custom, clamped: !!range.clamped },
    target,
    targetMonth: tm,
    season: range.custom ? null : { label: seasonRange.label, dealsCount: seasonInv.length, commissionToman: seasonInv.reduce((t, d) => t + d.commissionToman, 0) + seasonRewards(user.id, email, range.jy, range.jm) },
    totals: {
      commissionToman: commission, dealsCommissionToman: dealsCommission, targetRewardToman: rewardToman, dealsCount: inv.length, noInvoiceCount: deals.length - inv.length, salesToman: sales,
      avgRatePercent: avg((d) => d.ratePercent), avgDiscountPercent: avg((d) => d.discountPercent),
      nextTier: tier ? { rate: tier.rate, remainingToman: Math.max(0, tier.threshold - best + 1), progress: Math.min(100, Math.round((best / tier.threshold) * 100)) } : null,
    },
    deals,
  };
}

// سرپرستِ تیم فروش = مدیرِ مستقیمِ (manager_id) حداقل یک عضو نگاشت‌شده؛ مبلغ اعضای تیم خودش را می‌بیند (admin/owner هم همه را می‌بینند)
// کف بازه برای کسی که ادمین/مالک/سرپرست نیست: ابتدای فصل جاری یا ماه قبل (هر کدام زودتر)؛ «کل زمان» برای او بسته است
// مالک‌های معامله‌ی دیدار که کارمند فعالِ نگاشت‌شده نیستند؛ کلید: ایمیل یا «name:نام» (وقتی دیدار ایمیل نمی‌دهد)
function formerOwners() {
  const db = getDb();
  const active = new Set(db.prepare("SELECT didar_email FROM users WHERE is_active = 1 AND didar_email IS NOT NULL AND didar_email <> '' AND role <> 'owner'").all().map((u) => String(u.didar_email).toLowerCase()));
  const inactiveName = new Map(db.prepare("SELECT didar_email, full_name FROM users WHERE is_active = 0 AND didar_email IS NOT NULL AND didar_email <> ''").all().map((u) => [String(u.didar_email).toLowerCase(), u.full_name]));
  return db.prepare("SELECT owner_email, MAX(owner_name) AS owner_name FROM sales_deals GROUP BY owner_email, CASE WHEN owner_email = '' THEN owner_name ELSE '' END").all()
    .map((r) => (r.owner_email ? { key: String(r.owner_email).toLowerCase(), name: r.owner_name } : (r.owner_name ? { key: `name:${r.owner_name}`, name: r.owner_name } : null)))
    .filter((r) => r && !active.has(r.key))
    .map((r) => ({ key: r.key, name: inactiveName.get(r.key) || r.name || r.key }));
}

function floorFor(isPrivileged) {
  if (isPrivileged) return null;
  const now = toJalaliFromDate(new Date());
  const pj = now.jm === 1 ? { jy: now.jy - 1, jm: 12 } : { jy: now.jy, jm: now.jm - 1 };
  const a = seasonOf(now.jy, now.jm).from; const b = jalaliMonthRangeOf(pj.jy, pj.jm).from;
  return a < b ? a : b;
}

function leaderboard(viewer, q = {}) {
  const { jy, jm } = q;
  const month = monthOf(jy, jm);
  const periods = { month, season: seasonOf(month.jy, month.jm) };
  const members = getDb().prepare("SELECT id, full_name, didar_email, manager_id, role FROM users WHERE is_active = 1 AND didar_email IS NOT NULL AND didar_email <> '' AND role <> 'owner'").all();
  const isAdmin = ['admin', 'owner'].includes(viewer.role);
  const isSupervisor = members.some((u) => u.manager_id === viewer.id);
  const canSee = null; // سرپرستِ فروش مثل ادمین همه‌ی مبالغِ تیم فروش (حتی سابق‌ها) را می‌بیند (استثنا به تصریح مالک)
  // کارشناسان فروشِ سابق (و هر مالکِ معامله‌ی دیدار که کارمند فعالِ نگاشت‌شده نیست): فقط در لیدربرد، بدون حساب در پنل
  const activeEmails = new Set(members.map((u) => String(u.didar_email).toLowerCase()));
  const inactiveName = new Map(getDb().prepare("SELECT didar_email, full_name FROM users WHERE is_active = 0 AND didar_email IS NOT NULL AND didar_email <> ''").all().map((u) => [String(u.didar_email).toLowerCase(), u.full_name]));
  const former = getDb().prepare("SELECT owner_email, MAX(owner_name) AS owner_name FROM sales_deals GROUP BY owner_email, CASE WHEN owner_email = '' THEN owner_name ELSE '' END").all()
    .map((r) => (r.owner_email ? { email: String(r.owner_email).toLowerCase(), name: r.owner_name } : (r.owner_name ? { email: `name:${r.owner_name}`, name: r.owner_name } : null)))
    .filter((r) => r && !activeEmails.has(r.email));
  const rowOf = (name, email, base) => {
    const all = dealsOfMonth(base, email);
    const inv = all.filter((d) => !d.noInvoice);
    const amount = inv.reduce((t, d) => t + d.amountToman, 0);
    return {
      name, count: inv.length, amountToman: amount, dealsTotal: all.length, noInvoiceCount: all.length - inv.length,
      commissionToman: inv.reduce((t, d) => t + d.commissionToman, 0),
      avgInvoiceToman: inv.length ? Math.round(amount / inv.length) : 0,
      maxInvoiceToman: inv.reduce((m, d) => Math.max(m, d.amountToman), 0),
      avgDiscountPercent: inv.length ? Math.round((inv.reduce((t, d) => t + d.discountPercent, 0) / inv.length) * 10) / 10 : 0,
    };
  };
  const build = (range) => {
    const rows = [
      ...members.map((u) => ({ userId: u.id, ...rowOf(u.full_name, String(u.didar_email).toLowerCase(), range) })),
      ...former.map((f) => ({ userId: `f:${f.email}`, former: true, ...rowOf(inactiveName.get(f.email) || f.name || f.email, f.email, range) })),
    ].filter((r) => !r.former || r.dealsTotal > 0); // سابق‌ها اگر معامله‌ی موفق (حتی بدون فاکتور) در بازه دارند می‌آیند
    return { label: range.label, ...buildLeaderboards(rows, viewer.id, { canSeeAll: isAdmin || isSupervisor, canSee }) };
  };
  if (q.from && q.to) {
    const r = rangeOf(q, { floor: floorFor(isAdmin || isSupervisor) });
    if (r.custom) return { range: { from: r.from, to: r.to, label: r.label, clamped: !!r.clamped }, ...build(r) };
  }
  return { monthLabel: month.label, month: build(periods.month), season: build(periods.season), all: isAdmin || isSupervisor ? build(ALL_TIME) : null };
}

// ادمین/مالک و سرپرستِ تیم فروش لیدربرد تیمی را می‌بینند (حتی بدون ایمیل دیدار برای خودشان)
function canViewTeam(viewer) {
  if (['admin', 'owner'].includes(viewer.role)) return true;
  return !!getDb().prepare("SELECT 1 FROM users WHERE is_active = 1 AND manager_id = ? AND didar_email IS NOT NULL AND didar_email <> '' LIMIT 1").get(viewer.id);
}

// اعضایی که این کاربر می‌تواند کارت پورسانتشان را ببیند: ادمین/مالک همه؛ سرپرست فقط زیرمجموعه‌ی مستقیم
function visibleMembers(viewer) {
  const all = getDb().prepare("SELECT id, full_name, didar_email, manager_id FROM users WHERE is_active = 1 AND didar_email IS NOT NULL AND didar_email <> '' AND role <> 'owner' ORDER BY full_name").all();
  if (canViewTeam(viewer)) return all; // ادمین/مالک و سرپرستِ فروش
  return [];
}
function membersSummary(viewer, ym = {}) {
  const rows = visibleMembers(viewer).map((u) => { const c = myCommission(u, ym); return { userId: u.id, name: u.full_name, ...(c ? { commissionToman: c.totals.commissionToman, dealsCount: c.totals.dealsCount, salesToman: c.totals.salesToman, avgRatePercent: c.totals.avgRatePercent, seasonToman: c.season ? c.season.commissionToman : null } : {}) }; });
  if (canViewTeam(viewer)) {
    for (const f of formerOwners()) {
      const c = myCommission({ didar_email: f.key }, ym);
      rows.push({ userId: `f:${f.key}`, name: f.name, isFormer: true, ...(c ? { commissionToman: c.totals.commissionToman, dealsCount: c.totals.dealsCount, salesToman: c.totals.salesToman, avgRatePercent: c.totals.avgRatePercent, seasonToman: c.season ? c.season.commissionToman : null } : {}) });
    }
  }
  return { monthLabel: rangeOf(ym).label, range: { from: rangeOf(ym).from, to: rangeOf(ym).to }, members: rows.sort((a, b) => (a.isFormer ? 1 : 0) - (b.isFormer ? 1 : 0) || (b.commissionToman || 0) - (a.commissionToman || 0)) };
}
function memberCommission(viewer, id, ym) {
  if (String(id).startsWith('f:')) {
    if (!canViewTeam(viewer)) return null;
    const f = formerOwners().find((x) => `f:${x.key}` === String(id));
    return f ? { name: f.name, isFormer: true, commission: myCommission({ didar_email: f.key }, ym) } : null;
  }
  const u = visibleMembers(viewer).find((m) => m.id === Number(id));
  return u ? { name: u.full_name, userId: u.id, canSetTarget: canSetTarget(viewer, u), commission: myCommission(u, ym) } : null;
}

/** تعیین/ویرایش هدف ماهانه‌ی یک کارمند: ادمین/مالک یا مدیر مستقیمِ همان کارمند. */
const MAX_AMOUNT = 1e12;
const intAmount = (v) => (typeof v === 'number' || (typeof v === 'string' && /^\d+$/.test(v.trim())) ? Math.round(Number(v)) : NaN);
function canSetTarget(viewer, member) {
  return ['admin', 'owner'].includes(viewer.role) || (member && member.manager_id === viewer.id);
}
function targetMember(id) {
  return getDb().prepare("SELECT id, full_name, manager_id, didar_email FROM users WHERE id = ? AND is_active = 1 AND didar_email IS NOT NULL AND didar_email <> '' AND role <> 'owner'").get(Number(id)) || null;
}
const failT = (status, code, error) => ({ ok: false, status, code, error });
function parseMonth(body) {
  const now = toJalaliFromDate(new Date());
  const jy = Number.isInteger(body.jy) ? body.jy : now.jy; const jm = Number.isInteger(body.jm) ? body.jm : now.jm;
  return jy >= 1300 && jy <= 1600 && jm >= 1 && jm <= 12 ? { jy, jm } : null;
}
function setTarget(viewer, memberId, body = {}, { ip = null } = {}) {
  const m = targetMember(memberId);
  if (!m) return failT(404, 'NOT_FOUND', 'این همکار پیدا نشد.');
  if (!canSetTarget(viewer, m)) return failT(403, 'FORBIDDEN', 'فقط مدیر مستقیمِ این همکار یا مدیریت می‌تواند هدف تعیین کند.');
  const ym = parseMonth(body);
  if (!ym) return failT(400, 'VALIDATION', 'ماه نامعتبر است.');
  const targetToman = intAmount(body.targetToman); const rewardToman = body.rewardToman == null || body.rewardToman === '' ? 0 : intAmount(body.rewardToman);
  if (!(targetToman > 0) || targetToman > MAX_AMOUNT) return failT(400, 'VALIDATION', 'مبلغ هدف باید یک عدد مثبت (تومان) باشد.');
  if (!(rewardToman >= 0) || rewardToman > MAX_AMOUNT) return failT(400, 'VALIDATION', 'مبلغ تشویقی باید صفر یا عدد مثبت (تومان) باشد.');
  const rewardNote = String(body.rewardNote || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 160);
  const r = salesTargets.upsert({ userId: m.id, ...ym, targetToman, rewardToman, rewardNote, setBy: viewer.id });
  require('../repositories/auditRepository').logEvent({ userId: viewer.id, action: 'sales_target_set', ipAddress: ip, details: { memberId: m.id, jy: ym.jy, jm: ym.jm, targetToman, rewardToman, rewardNote, before: r.before ? { targetToman: r.before.target_toman, rewardToman: r.before.reward_toman } : null } });
  return { ok: true, target: targetInfo(m.id, String(m.didar_email).toLowerCase(), ym) };
}
function removeTarget(viewer, memberId, body = {}, { ip = null } = {}) {
  const m = targetMember(memberId);
  if (!m) return failT(404, 'NOT_FOUND', 'این همکار پیدا نشد.');
  if (!canSetTarget(viewer, m)) return failT(403, 'FORBIDDEN', 'فقط مدیر مستقیمِ این همکار یا مدیریت می‌تواند هدف را حذف کند.');
  const ym = parseMonth(body);
  if (!ym) return failT(400, 'VALIDATION', 'ماه نامعتبر است.');
  const prev = salesTargets.remove(m.id, ym.jy, ym.jm);
  if (prev) require('../repositories/auditRepository').logEvent({ userId: viewer.id, action: 'sales_target_removed', ipAddress: ip, details: { memberId: m.id, jy: ym.jy, jm: ym.jm, targetToman: prev.target_toman } });
  return { ok: true, removed: !!prev };
}

// فقط تیم فروش (کارمندِ دارای ایمیل دیدار) و ادمین/مالک/سرپرستِ فروش به بخش فروش دسترسی دارند؛ بقیه‌ی کارمندها هیچ
function hasSalesAccess(viewer) {
  if (canViewTeam(viewer)) return true;
  const r = getDb().prepare('SELECT didar_email FROM users WHERE id = ?').get(viewer.id);
  return !!(r && r.didar_email);
}

module.exports = { setTarget, removeTarget, targetInfo, targetMonthOf, rangeOf, dealsOfMonth, hasSalesAccess, floorFor, formerOwners, visibleMembers, membersSummary, memberCommission, canViewTeam, sync, syncIfStale, myCommission, leaderboard, normalizeDeal, AMOUNT_TIERS };
