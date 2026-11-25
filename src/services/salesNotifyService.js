// اعلان تلگرامِ تیم فروش: وقتی بعد از همگام‌سازی با دیدار معامله‌ی «موفقِ» تازه‌ای پیدا شود، به خودِ کارشناس پیام تشویقی می‌رود
// (با مبلغ پورسانتِ همان فاکتور و جمع ماه)، و اگر «شناسه‌ی گروه فروش» تنظیم شده باشد یک تبریک کوتاه «بدون هیچ مبلغی» به گروه.
// • هر معامله فقط یک‌بار اعلام می‌شود (sales_announced)؛ اولین همگام‌سازیِ بعد از نصب بی‌صدا مبنا می‌شود (بدون سیل پیام قدیمی).
// • فقط معامله‌های ۳ روز اخیر، دارای فاکتور و متعلق به کارمندِ فعالِ نگاشت‌شده؛ معامله‌ی بدون فاکتور تا ۳ روز منتظر فاکتور می‌ماند.
// • پیام‌ها از ترکیب «تیتر × پایان» ساخته می‌شود تا هر بار متفاوت باشد؛ rng برای تست تزریق‌پذیر است.
'use strict';
const { getDb } = require('../db/connection');
const settingsRepository = require('../repositories/settingsRepository');
const { notify } = require('./notificationService');
const { sendMessage } = require('../bot/notifier');
const service = require('./commissionService');
const { jalaliPartsOfDateString } = require('../utils/jalali');

const WINDOW_DAYS = 3;
const fa = (v) => String(v).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);
const money = (n) => fa(Math.round(Number(n) || 0).toLocaleString('en-US').replace(/,/g, '٬'));
const tehranDate = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tehran' }).format(d);

// ---- بانک پیام‌ها: تیتر (با نام) و پایان تشویقی؛ هر نوع جدا ----
const HEADLINES = {
  deal: [
    (c) => `🎉 ${c.name} عزیز، معامله‌ی تازه‌ات ثبت شد!`,
    (c) => `🌟 دمت گرم ${c.name}! یک فاکتور دیگر به نام تو خورد`,
    (c) => `💪 ${c.name} جان، یک معامله‌ی موفق دیگر!`,
    (c) => `✨ خبر خوب برای ${c.name}: معامله‌ات تأیید شد`,
    (c) => `🏆 آفرین ${c.name}! یک فروش دیگر روی کارنامه‌ات نشست`,
    (c) => `🚀 ${c.name}، مسیر پورسانتت یک قدم دیگر بلندتر شد`,
    (c) => `👏 تبریک ${c.name}! این معامله هم موفق شد`,
    (c) => `🔥 ${c.name} داغِ داغ! معامله‌ی تازه ثبت شد`,
    (c) => `🌈 ${c.name} عزیز، تلاشت نتیجه داد؛ معامله موفق شد`,
    (c) => `⭐ ${c.name}، یک ستاره‌ی دیگر به فروش‌های این ماهت اضافه شد`,
  ],
  tier: [
    (c) => `🚀 ${c.name} جان، رفتی پله‌ی بالاتر!`,
    (c) => `🏅 ${c.name} عزیز، فاکتورت از رکوردِ قبلیِ این ماه گذشت`,
    (c) => `👑 آفرین ${c.name}! به پله‌ی بالاتر پورسانت رسیدی`,
    (c) => `🌟 ${c.name}، این فاکتور بزرگ‌ترین فاکتور این ماهت شد`,
    (c) => `🔥 ${c.name} ترکاندی! درصد پورسانتِ مبلغ بالاتر رفت`,
    (c) => `✨ تبریک ${c.name}، یک پله بالاتر ایستادی`,
  ],
  milestone: [
    (c) => `🎯 ${c.name} عزیز، فاکتور شماره‌ی ${fa(c.count)} این ماه!`,
    (c) => `🏆 ${c.name} جان، ${fa(c.count)} فاکتور در یک ماه؛ حرف نداری`,
    (c) => `🥳 جشن بگیر ${c.name}! ${fa(c.count)} فاکتورِ این ماه کامل شد`,
    (c) => `💎 ${c.name}، ${fa(c.count)} فاکتور موفق این ماه ثبت شد`,
    (c) => `🌠 ${c.name} فوق‌العاده‌ای! ${fa(c.count)} معامله‌ی موفق در این ماه`,
  ],
  ineligible: [
    (c) => `✅ ${c.name} عزیز، معامله‌ات ثبت شد`,
    (c) => `🤝 ${c.name} جان، یک معامله‌ی دیگر بستی`,
    (c) => `📌 ${c.name}، معامله‌ی تازه‌ات در دیدار موفق شد`,
    (c) => `🙌 دستت درد نکند ${c.name}، معامله‌ی تازه ثبت شد`,
  ],
};
const CLOSINGS = {
  deal: [
    'با همین انرژی ادامه بده، مسیر روشن است ✨',
    'هر فاکتور یک قدم به هدف‌های بزرگ‌تر است. ادامه بده 💪',
    'تلاشت دیده می‌شود و نتیجه‌اش هم همین است. ایول! 👏',
    'ماه هنوز تمام نشده؛ فاکتورهای قشنگ‌تر در راه‌اند 🌱',
    'تو بلدی چطور مشتری را راضی کنی. ادامه بده 🌟',
    'امروز یک برد دیگر؛ فردا بردِ بزرگ‌تر 🚀',
    'قدردان زحمت‌هایت هستیم. موفق باشی 🌸',
    'پشتکار تو الهام‌بخش تیم است. دمت گرم! 🔥',
    'این فقط شروع این ماه است؛ آسمان هم حدّ نیست 🌤️',
    'لبخند بزن، فروش‌هایت دارند حرف می‌زنند 😊',
  ],
  tier: [
    'فاکتورهای بزرگ‌تر یعنی درصد پورسانتِ بیشتر؛ همین مسیر را برو 🚀',
    'رکوردها برای شکستن‌اند، و تو داری می‌شکنی 🏅',
    'این پله فقط یک ایستگاه است؛ بالاتر هم جا هست 👑',
    'مشتری‌ها به تو اعتماد دارند و این نتیجه‌اش است 🤝',
    'با این سرعت، بالاترین پله هم دور نیست 🌟',
    'افتخار می‌کنیم که تو در تیم ما هستی 💙',
  ],
  milestone: [
    'پیوستگیِ تو بی‌نظیر است. به همین ریتم ادامه بده 🌟',
    'عدد قشنگی است، ولی تو قطعاً بیشتر می‌توانی 💪',
    'هر فاکتور پشتش یک گفتگوی خوب است؛ دمت گرم 👏',
    'به اینجا رسیدن همتِ بلند می‌خواهد. آفرین! 🏆',
    'ادامه بده، تیم پشتت ایستاده 🤗',
  ],
  ineligible: [
    'این معامله به‌دلیل تخفیف بیش از حد مجاز پورسانت ندارد؛ دفعه‌ی بعد با تخفیف کمتر، پورسانت هم خواهد بود. تو از پسش برمی‌آیی 💪',
    'پورسانت این یکی به‌خاطر سقف تخفیف صفر است، اما فروش ثبت شد و تجربه‌اش ماند. معامله‌ی بعدی را قوی‌تر ببند 🌱',
    'سقف تخفیف رد شده و پورسانت ندارد؛ مهم نیست، تو نیرویی برای معامله‌های بعدی هستی. ادامه بده ✨',
    'این بار پورسانتی نصیب نشد (تخفیف بالا)، اما مسیر باز است. نفس عمیق، معامله‌ی بعدی را هم می‌بری 🌟',
  ],
};
const GROUP_LINES = {
  deal: [
    (c) => `🎉 ${c.name} یک معامله‌ی تازه بست! تبریک 👏`,
    (c) => `🔥 دمِ ${c.name} گرم! یک فاکتور دیگر ثبت شد`,
    (c) => `🌟 ${c.name} دوباره درخشید؛ معامله‌ی تازه ثبت شد`,
    (c) => `💪 آفرین به ${c.name} برای معامله‌ی موفق جدید`,
    (c) => `🚀 ${c.name} یک فروش دیگر به تیم اضافه کرد`,
    (c) => `✨ خبر خوب: معامله‌ی تازه‌ی ${c.name} تأیید شد`,
  ],
  tier: [
    (c) => `🏅 ${c.name} به پله‌ی بالاتری رسید! تبریک`,
    (c) => `👑 ${c.name} رکورد فاکتورِ این ماهش را شکست`,
    (c) => `🚀 ${c.name} پله‌ی بالاتر را فتح کرد. آفرین!`,
  ],
  milestone: [
    (c) => `🎯 ${c.name} فاکتور شماره‌ی ${fa(c.count)} این ماه را ثبت کرد!`,
    (c) => `🥳 ${fa(c.count)} فاکتور برای ${c.name} در این ماه؛ دمش گرم`,
    (c) => `💎 ${c.name} به ${fa(c.count)} فاکتورِ ماه رسید`,
  ],
};
const pick = (arr, rng) => arr[Math.min(arr.length - 1, Math.floor(rng() * arr.length))];

// نوع پیام برای یک معامله: ineligible > tier > milestone > deal
function kindOf(ctx) {
  if (!ctx.deal.eligible) return 'ineligible';
  if (ctx.tierUp) return 'tier';
  if (ctx.count >= 5 && ctx.count % 5 === 0) return 'milestone';
  return 'deal';
}

function buildPrivateMessage(ctx, rng = Math.random) {
  const kind = kindOf(ctx);
  const d = ctx.deal;
  const lines = [`📄 ${d.title}${d.customer ? ` — ${d.customer}` : ''}`, `💳 مبلغ فاکتور: ${money(d.amountToman)} تومان`];
  if (d.eligible) lines.push(`💰 پورسانت این فاکتور: ${money(d.commissionToman)} تومان (${fa(d.ratePercent)}٪)`, `📊 جمع پورسانت این ماه: ${money(ctx.monthCommission)} تومان از ${fa(ctx.count)} فاکتور`);
  if (kind === 'tier') lines.push(`🏅 درصد پله‌ی مبلغِ این فاکتور: ${fa(d.amountRate)}٪`);
  return { kind, title: pick(HEADLINES[kind], rng)(ctx), body: `${lines.join('\n')}\n\n${pick(CLOSINGS[kind], rng)}` };
}
function buildGroupMessage(ctx, rng = Math.random) {
  const kind = kindOf(ctx);
  const pool = GROUP_LINES[kind === 'ineligible' ? 'deal' : kind];
  return pick(pool, rng)(ctx);
}

// زمینه‌ی یک معامله‌ی تازه: جمع/تعداد ماهِ شمسیِ همان معامله تا خودش + آیا پله‌ی مبلغ بالاتر از قبلی‌های ماه است
function contextFor(user, row) {
  const day = tehranDate(new Date(row.won_at));
  const j = jalaliPartsOfDateString(day);
  const range = service.rangeOf({ jy: j.jy, jm: j.jm });
  const email = String(user.didar_email).toLowerCase();
  const upto = service.dealsOfMonth(range, email).filter((d) => !d.noInvoice);
  const mine = upto.find((d) => String(d.id) === String(row.didar_id));
  if (!mine) return null;
  const wonAt = new Map(getDb().prepare('SELECT didar_id, won_at FROM sales_deals').all().map((r) => [String(r.didar_id), r.won_at]));
  const sorted = upto.slice().sort((a, b) => String(wonAt.get(String(a.id)) || '').localeCompare(String(wonAt.get(String(b.id)) || '')) || String(a.id).localeCompare(String(b.id)));
  const idx = sorted.findIndex((d) => String(d.id) === String(row.didar_id));
  const upToMe = sorted.slice(0, idx + 1);
  const earlier = sorted.slice(0, idx);
  const tierUp = mine.eligible && earlier.length > 0 && mine.amountRate > Math.max(...earlier.map((d) => d.amountRate || 0));
  return { name: String(user.full_name || '').trim().split(/\s+/)[0] || 'همکار', deal: mine, count: upToMe.length, monthCommission: upToMe.reduce((t, d) => t + d.commissionToman, 0), tierUp };
}

async function announceNewDeals({ now = new Date(), rng = Math.random, sendTelegram, sendGroup } = {}) {
  const db = getDb();
  const deals = db.prepare('SELECT didar_id, owner_email, won_at FROM sales_deals ORDER BY won_at ASC').all();
  const markAll = (ids) => { const ins = db.prepare('INSERT OR IGNORE INTO sales_announced (didar_id) VALUES (?)'); db.transaction(() => ids.forEach((i) => ins.run(i)))(); };
  const baselined = db.prepare('SELECT 1 FROM sales_announce_state WHERE id = 1').get();
  const settings = settingsRepository.getAll();
  if (!baselined || !settings.salesNotifyEnabled) { // مبنا/خاموش ⇒ بی‌صدا همه را «اعلام‌شده» کن
    markAll(deals.map((d) => d.didar_id));
    if (!baselined) db.prepare("INSERT INTO sales_announce_state (id, baselined_at) VALUES (1, datetime('now'))").run();
    return { baseline: !baselined, sent: 0 };
  }
  const done = new Set(db.prepare('SELECT didar_id FROM sales_announced').all().map((r) => r.didar_id));
  const freshFrom = tehranDate(new Date(now.getTime() - WINDOW_DAYS * 86400000));
  const users = db.prepare("SELECT id, full_name, didar_email FROM users WHERE is_active = 1 AND role <> 'owner' AND didar_email IS NOT NULL AND didar_email <> ''").all();
  const byEmail = new Map(users.map((u) => [String(u.didar_email).toLowerCase(), u]));
  const groupId = String(settings.salesGroupChatId || '').trim();
  const finished = []; let sent = 0;
  for (const row of deals) {
    if (done.has(row.didar_id)) continue;
    const fresh = tehranDate(new Date(row.won_at)) >= freshFrom;
    const user = byEmail.get(String(row.owner_email || '').toLowerCase());
    if (!fresh || !user) { finished.push(row.didar_id); continue; }
    let ctx = null;
    try { ctx = contextFor(user, row); } catch (err) { console.error('[sales-notify] خطا در ساخت زمینه:', err.message); }
    if (!ctx) continue; // هنوز فاکتور ندارد ⇒ تا خروج از بازه‌ی ۳ روزه منتظر بماند
    try {
      const m = buildPrivateMessage(ctx, rng);
      await notify(user.id, { type: 'sales_deal_won', title: m.title, body: m.body, link: '#/commission', dedupeKey: `sales_deal:${row.didar_id}`, telegram: true }, sendTelegram ? { sendTelegram } : {});
      if (groupId) await (sendGroup || sendMessage)(groupId, buildGroupMessage(ctx, rng));
      sent += 1;
    } catch (err) { console.error('[sales-notify] ارسال ناموفق:', err.message); }
    finished.push(row.didar_id);
  }
  markAll(finished);
  return { baseline: false, sent };
}

module.exports = { announceNewDeals, buildPrivateMessage, buildGroupMessage, contextFor, HEADLINES, CLOSINGS, GROUP_LINES };
