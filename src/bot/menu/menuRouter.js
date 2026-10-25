// E1/E2 (فاز ۱۰): منوی دکمه‌ایِ نقش‌محور بات.
//   • buildMainKeyboard(user): کیبورد ثابت پایین چت؛ H2: فقط یک دکمه‌ی «📂 منو» (فقط چت خصوصی).
//   • buildMenuInline(user) / sendMenu: با لمس «📂 منو» یک پیام با inline_keyboard نقش‌محور (۲ ستونه، گروه‌بندی‌شده، «✖️ بستن منو»)
//     فرستاده می‌شود؛ آیتم‌های handler با callback «mn:<id>» و آیتم‌های web_app با دکمه‌ی inline از نوع web_app (https).
//   • routeMenuText(bot, msg): تشخیص متنِ دکمه با «تطبیق دقیق» (نرمال‌سازی ی/ک، حذف ایموجی و فاصله‌ی اضافه) و اتصال آن
//     به handlerهای موجود — بدون کپی منطق. نقش هر بار از دیتابیس خوانده و سمت سرور دوباره چک می‌شود؛
//     یعنی ارسال دستیِ متنِ یک دکمه‌ی ادمین توسط کارمند اجرا نمی‌شود.
// کاربر ثبت‌نشده منو ندارد.

const session = require('../session');
const { getRegisteredUser, notRegisteredMessage, hasRole } = require('../auth');
const panelLinks = require('../panelLinks');

const MANAGER_UP = ['manager', 'admin'];
const ADMIN_ONLY = ['admin'];

// H2: تنها دکمه‌ی کیبورد پایین چت و پیام منوی inline
const MENU_LABEL = '📂 منو';
const MENU_TEXT = '📂 منو — یکی از گزینه‌ها را انتخاب کنید:';
const MENU_NOOP_ID = '_'; // دکمه‌ی سرتیتر گروه (بدون عمل)
const MENU_CLOSE_ID = '_close'; // «✖️ بستن منو»
const LEGACY_KEYBOARD_NOTE = 'منوی ربات ساده‌تر شد 👇 همه‌ی گزینه‌ها حالا پشت دکمه‌ی «📂 منو» هستند.';
// style: رنگ دکمه‌های گروه (Bot API 9.4+؛ فقط همین سه مقدار مجاز است): primary آبی، success سبز، danger قرمز.
// کلاینت‌های قدیمی فیلد را نادیده می‌گیرند و دکمه با رنگ پیش‌فرض نمایش داده می‌شود.
const MENU_GROUPS = [
  { key: 'me', title: 'کارهای من', style: 'primary' },
  { key: 'team', title: 'تیم', style: 'success' },
  { key: 'admin', title: 'مدیریت', style: 'danger' },
];

// roles = null ⇒ هر کاربر ثبت‌شده. url = تابعِ آدرسِ web_app (دکمه‌ی web_app، نه متنی).
// ترتیب آرایه همان ترتیب نمایش است: کارمند، سپس افزوده‌های سرپرست، سپس افزوده‌های ادمین (ادمین همه را دارد).
const ITEMS = [
  { id: 'checkin', label: '🕒 ثبت تردد', roles: null, url: () => panelLinks.miniAppLink(), handler: 'miniApp' },
  { id: 'remote_work', label: '🏠 ثبت دورکاری', roles: null, handler: 'remoteWork' },
  { id: 'status', label: '📊 وضعیت من', roles: null, handler: 'status' },
  { id: 'report', label: '📈 گزارش من', roles: null, handler: 'report' },
  { id: 'leave', label: '🏖 مرخصی / 🚗 ماموریت', roles: null, handler: 'leave' },
  { id: 'plan', label: '📋 برنامه هفتگی', roles: null, url: () => panelLinks.miniAppLink({ view: 'plan' }), handler: 'miniApp' },
  { id: 'panel', label: '🖥 پنل', roles: null, handler: 'panel' },
  { id: 'help', label: '❓ راهنما', roles: null, handler: 'help' },

  { id: 'team_report', label: '👥 گزارش تیم', roles: MANAGER_UP, handler: 'teamReport' },
  { id: 'pending_leaves', label: '📥 درخواست‌های منتظر', roles: MANAGER_UP, handler: 'pendingLeaves' },
  { id: 'pending_disputes', label: '💬 اعتراض‌ها', roles: MANAGER_UP, handler: 'pendingDisputes' },
  // R6 (فاز ۱۴): badge = تعداد دورکاری منتظر بررسی؛ در متن دکمه‌ی منوی inline می‌آید («… (۳)»)، صفر ⇒ بدون عدد
  { id: 'pending_remote', label: '🏠 دورکاری‌های منتظر', roles: MANAGER_UP, handler: 'pendingRemote', badge: (user) => require('../../services/remoteWorkAdminService').pendingSummary(user) },
  { id: 'yesterday_reports', label: '📝 گزارش‌های دیروز تیم', roles: MANAGER_UP, handler: 'yesterdayReports' },
  { id: 'list_members', label: '👤 لیست اعضا', roles: MANAGER_UP, handler: 'listEmployees' },
  { id: 'urgent_task', label: '⚡ تسک فوری', roles: MANAGER_UP, handler: 'urgentTask' },

  { id: 'add_employee', label: '➕ افزودن کارمند', roles: ADMIN_ONLY, handler: 'addEmployee' },
  { id: 'fix_record', label: '🛠 اصلاح رکورد', roles: ADMIN_ONLY, handler: 'fixRecord' },
  { id: 'admin_panel', label: '⚙️ پنل مدیریت', roles: ADMIN_ONLY, url: () => panelLinks.panelUrl(), handler: 'panel' },
];

const EMOJI_RE = /[\p{Extended_Pictographic}\p{Emoji_Presentation}\p{Emoji_Modifier}\u20E3\uFE00-\uFE0F\u200D]/gu;

/** متن دکمه را برای مقایسه‌ی دقیق یکسان می‌کند: ی/ک عربی، همزه، اعراب/کشیده، ایموجی، نیم‌فاصله و فاصله‌های اضافه. */
function normalizeLabel(text) {
  return String(text === undefined || text === null ? '' : text)
    .normalize('NFKC')
    .replace(EMOJI_RE, ' ')
    .replace(/[\u064A\u0649]/g, '\u06CC') // ي ى → ی
    .replace(/\u0643/g, '\u06A9') // ك → ک
    .replace(/[\u0623\u0625\u0622]/g, '\u0627') // أ إ آ → ا (هر دو طرف مقایسه نرمال می‌شوند)
    .replace(/\u0624/g, '\u0648') // ؤ → و
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '') // اعراب و کشیده
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060\uFEFF]/g, ' ') // نیم‌فاصله (ZWNJ) و نشانه‌های جهت ⇒ فاصله
    .replace(/\s*\/\s*/g, ' / ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function hasEmoji(text) {
  return new RegExp(EMOJI_RE.source, 'u').test(String(text || ''));
}

const ITEM_BY_LABEL = new Map(ITEMS.map((it) => [normalizeLabel(it.label), it]));
// «📂 منو» آیتم واقعی نیست (handler/url ندارد)؛ فقط برای این‌که routeMenuText با همان قواعد (ثبت‌نام، چت خصوصی، قاعده‌ی session) تشخیصش دهد
const MENU_ITEM = { id: 'menu_open', label: MENU_LABEL, roles: null };
ITEM_BY_LABEL.set(normalizeLabel(MENU_LABEL), MENU_ITEM);

function roleAllowed(item, user) {
  return !item.roles || hasRole(user, item.roles);
}

/** آیتم‌های قابل‌نمایش برای کاربر (بر اساس نقش). H3: آیتم web_app بدون https پنهان نمی‌شود؛ لمس دکمه‌اش راهنمای ادمین را نشان می‌دهد. */
function itemsFor(user) {
  if (!user) return [];
  return ITEMS.filter((it) => roleAllowed(it, user));
}

/**
 * کیبورد ثابتِ پایین چت (H2): فقط یک دکمه‌ی «📂 منو». null برای کاربر ثبت‌نشده و برای چت غیرخصوصی (وقتی chatType داده شود).
 * بقیه‌ی دکمه‌ها (به‌تفکیک نقش) در پیام منوی inline می‌آیند (buildMenuInline).
 */
function buildMainKeyboard(user, { chatType } = {}) {
  if (chatType && chatType !== 'private') return null;
  if (itemsFor(user).length === 0) return null;
  return { keyboard: [[{ text: MENU_LABEL }]], resize_keyboard: true, is_persistent: true };
}

function groupOf(item) {
  if (!item.roles) return 'me';
  return item.roles === MANAGER_UP ? 'team' : 'admin';
}

// R6: آیتم دارای badge (تابع user ⇒ نتیجه‌ی pendingSummary) تعداد را در متن دکمه می‌آورد؛ هر خطا/صفر ⇒ همان متن ساده (منو هرگز نمی‌شکند)
function labelWithBadge(item, user) {
  if (typeof item.badge !== 'function') return item.label;
  try {
    const r = item.badge(user);
    const n = r && r.ok ? r.total : 0;
    return n > 0 ? `${item.label} (${n.toLocaleString('fa-IR')})` : item.label;
  } catch (err) {
    console.error('[menu] badge ناموفق (نادیده گرفته شد):', err && err.message);
    return item.label;
  }
}

/**
 * inline_keyboard پیام منو برای کاربر (۲ ستونه): کارمند ← افزوده‌های سرپرست ← افزوده‌های ادمین، با سرتیتر گروه
 * (فقط وقتی بیش از یک گروه هست؛ سرتیتر یک دکمه‌ی بی‌عمل «mn:_» است) و در انتها «✖️ بستن منو».
 * آیتم‌های web_app (فقط https) دکمه‌ی inline از نوع web_app می‌شوند (initData امضاشده فقط از این مسیر می‌آید).
 * H3: وقتی MINI_APP_URL https نیست دکمه‌ی web_app ساخته نمی‌شود؛ همان آیتم دکمه‌ی «mn:<id>» می‌گیرد که راهنمای ادمین را نشان می‌دهد.
 * null برای کاربر ثبت‌نشده.
 */
function buildMenuInline(user) {
  const items = itemsFor(user);
  if (items.length === 0) return null;
  const buckets = MENU_GROUPS.map((g) => ({ ...g, items: items.filter((it) => groupOf(it) === g.key) })).filter((b) => b.items.length > 0);
  const withHeads = buckets.length > 1;
  const rows = [];
  for (const b of buckets) {
    if (withHeads) rows.push([{ text: `— ${b.title} —`, callback_data: `mn:${MENU_NOOP_ID}`, style: b.style }]);
    const buttons = b.items.map((it) => (it.url && panelLinks.canUseWebApp(it.url()) ? { text: it.label, web_app: { url: it.url() }, style: b.style } : { text: labelWithBadge(it, user), callback_data: `mn:${it.id}`, style: b.style }));
    for (let i = 0; i < buttons.length; i += 2) rows.push(buttons.slice(i, i + 2));
  }
  rows.push([{ text: '✖️ بستن منو', callback_data: `mn:${MENU_CLOSE_ID}` }]);
  return { inline_keyboard: rows };
}

/** پیام منوی inline را برای کاربر می‌فرستد. */
async function sendMenu(bot, chatId, user) {
  const markup = buildMenuInline(user);
  if (!markup) {
    await bot.sendMessage(chatId, 'منویی برای شما در دسترس نیست.');
    return;
  }
  await bot.sendMessage(chatId, MENU_TEXT, { reply_markup: markup });
}

/**
 * H2: کاربری که هنوز کیبورد قدیمی (۱۵ دکمه‌ای) را دارد و روی یکی از دکمه‌هایش زده؛ دکمه‌ی قدیمی اجرا می‌شود و
 * یک پیام کوتاه همراه کیبورد جدید (فقط «📂 منو») می‌رود تا کیبورد قدیمی جایش را بدهد. خطا هرگز اجرای دکمه را نمی‌شکند.
 */
async function replaceLegacyKeyboard(bot, chatId, user) {
  const kb = buildMainKeyboard(user, { chatType: 'private' });
  if (!kb) return;
  try {
    await bot.sendMessage(chatId, LEGACY_KEYBOARD_NOTE, { reply_markup: kb });
  } catch (err) {
    console.error('[bot] خطا در جایگزینی کیبورد قدیمی:', err.message);
  }
}

// فقط پیام خودِ منو پاک می‌شود (نه اعلان‌هایی که دکمه‌ی mn:<id> زیرشان هست، مثل اعلان درخواست مرخصی)
function isMenuMessage(message) {
  return !!(message && typeof message.text === 'string' && message.text.startsWith('📂 منو'));
}

async function deleteMenuMessage(bot, message) {
  if (!message || !message.chat || message.message_id === undefined) return;
  try {
    await bot.deleteMessage(message.chat.id, message.message_id);
  } catch (_) {
    /* پیام قدیمی‌تر از ۴۸ ساعت یا قبلاً پاک‌شده؛ مهم نیست */
  }
}

// «📝 گزارش‌های دیروز تیم»: منطق گزارش تسک‌ها فقط در پنل است (صفحه‌ی «گزارش‌های تیم»)؛ بات همان صفحه را باز می‌کند.
async function sendTeamReportsLink(bot, msg) {
  const btn = panelLinks.panelWebAppButton({ view: 'teamreports', text: '🖥 گزارش‌های تیم' });
  if (!btn) {
    await bot.sendMessage(msg.chat.id, 'گزارش‌های تیم در پنل است. با دکمه‌ی «🖥 پنل» وارد شوید و صفحه‌ی «گزارش‌های تیم» را باز کنید.');
    return;
  }
  await bot.sendMessage(msg.chat.id, '📝 گزارش‌های تسک‌های دیروز تیم را در پنل ببینید:', { reply_markup: { inline_keyboard: [[btn]] } });
}

/** handlerهای موجود (lazy تا چرخه‌ی require پیش نیاید). تست می‌تواند نسخه‌ی جایگزین بدهد. */
function defaultHandlers() {
  return {
    status: require('../commands/status').handleStatus,
    report: require('../commands/report').handleReport,
    leave: require('../commands/leave').handleLeaveCommand,
    panel: require('../commands/panelLogin').handlePanelLogin,
    miniApp: require('../commands/miniAppLogin').handleMiniAppLogin,
    help: require('../commands/help').handleHelp,
    teamReport: require('../commands/teamReport').handleTeamReport,
    pendingLeaves: require('../commands/pendingLeaves').handlePendingLeaves,
    pendingDisputes: require('../commands/pendingDisputes').handlePendingDisputes,
    listEmployees: require('../commands/listEmployees').handleListEmployees,
    addEmployee: require('../commands/addEmployee').handleAddEmployeeCommand,
    fixRecord: require('../commands/fixRecord').handleFixRecordCommand,
    yesterdayReports: sendTeamReportsLink,
    urgentTask: require('../commands/urgentTask').handleUrgentTaskCommand,
    pendingRemote: require('../commands/pendingRemote').handlePendingRemote,
    remoteWork: require('../commands/remoteWork').handleRemoteWork,
  };
}

// دکمه‌ی web_app اگر به‌جای لمس، متنش تایپ شود: همان دکمه را به‌صورت inline می‌فرستیم.
async function sendWebAppLink(bot, chatId, item) {
  const url = item.url();
  if (!panelLinks.canUseWebApp(url)) {
    panelLinks.warnInsecureMiniAppUrl(`دکمه‌ی «${item.label}»`);
    await bot.sendMessage(chatId, 'این بخش فقط روی آدرس https کار می‌کند؛ به ادمین اطلاع دهید (MINI_APP_URL).');
    return;
  }
  await bot.sendMessage(chatId, 'برای باز کردن، دکمه‌ی زیر را بزنید:', {
    reply_markup: { inline_keyboard: [[{ text: item.label, web_app: { url } }]] },
  });
}

/**
 * اگر متن پیام یکی از دکمه‌های منو باشد آن را اجرا و true برمی‌گرداند؛ وگرنه false (پیام به مسیر session می‌رود).
 * قواعد: فقط چت خصوصی؛ نقش از دیتابیس؛ نقش نامجاز ⇒ پیام رد و handler اجرا نمی‌شود؛ زدن دکمه، مکالمه‌ی نیمه‌کاره را لغو می‌کند.
 */
async function routeMenuText(bot, msg, handlers) {
  if (!msg || typeof msg.text !== 'string' || msg.text.startsWith('/')) return false;
  if (!msg.chat || msg.chat.type !== 'private' || !msg.from) return false;

  const item = ITEM_BY_LABEL.get(normalizeLabel(msg.text));
  if (!item) return false;

  const chatId = msg.chat.id;
  // وسط مکالمه‌ی چندمرحله‌ای، متنِ «بی‌ایموجی» ورودی همان مرحله است (مثلاً علت مرخصی «راهنما»)، نه دکمه — دکمه‌ی واقعی همیشه ایموجی دارد.
  if (session.get(chatId) && !hasEmoji(msg.text)) return false;

  const user = getRegisteredUser(msg.from.id);
  if (!user) {
    await bot.sendMessage(chatId, notRegisteredMessage(msg.from.id), { parse_mode: 'Markdown' });
    return true;
  }
  if (!roleAllowed(item, user)) {
    await bot.sendMessage(chatId, '⛔️ این گزینه برای نقش شما در دسترس نیست.');
    return true;
  }

  if (item === MENU_ITEM) {
    // فقط باز کردن منو؛ مکالمه‌ی نیمه‌کاره با خودِ این لمس لغو نمی‌شود (با انتخاب یک آیتم یا handler لغو می‌شود)
    await sendMenu(bot, chatId, user);
    return true;
  }
  session.clear(chatId); // دکمه‌ی منو = شروع تازه؛ مکالمه‌ی قبلی (مثلاً ثبت مرخصیِ نیمه‌کاره) لغو می‌شود
  // متنِ دکمه‌ی عادی فقط از کیبورد قدیمی می‌آید (کیبورد جدید فقط «📂 منو» می‌فرستد)؛ کیبورد جدید را پیش از handler می‌فرستیم تا پیام خودِ handler آخرین پیام چت بماند
  await replaceLegacyKeyboard(bot, chatId, user);
  // بله برای ورود امن، لینک یک‌بارمصرف خودش را می‌فرستد؛ تلگرام همان web_app استاندارد را دریافت می‌کند.
  if (item.url && bot.platform !== 'bale') {
    await sendWebAppLink(bot, chatId, item);
    return true;
  }
  const fn = (handlers || defaultHandlers())[item.handler];
  await fn(bot, msg);
  return true;
}

/**
 * دکمه‌ی inline «mn:<id>» (مثلاً «📥 درخواست‌های منتظر» زیر اعلان درخواست مرخصی) ⇒ همان handlerِ دکمه‌ی منو.
 * نقش هر بار از دیتابیس خوانده می‌شود؛ دکمه‌ی ناشناخته ⇒ «این دکمه منقضی شده»؛ آیتم web_app ⇒ لینک inline یا راهنمای https (H3). هر callback دقیقاً یک‌بار answer می‌شود.
 */
async function handleMenuCallback(bot, query, handlers) {
  const id = String(query.data || '').slice(3);
  // H2: سرتیتر گروه (بی‌عمل) و «✖️ بستن منو» — بدون چک نقش
  if (id === MENU_NOOP_ID) {
    await bot.answerCallbackQuery(query.id);
    return;
  }
  if (id === MENU_CLOSE_ID) {
    await bot.answerCallbackQuery(query.id);
    await deleteMenuMessage(bot, query.message);
    return;
  }
  const item = ITEMS.find((it) => it.id === id);
  const chat = query.message && query.message.chat;
  if (!item || !chat || chat.type !== 'private' || !query.from) {
    await bot.answerCallbackQuery(query.id, { text: 'این دکمه منقضی شده، منو را باز کنید.', show_alert: true });
    return;
  }
  const user = getRegisteredUser(query.from.id);
  if (!user) {
    await bot.answerCallbackQuery(query.id, { text: 'شما در سیستم ثبت نیستید.', show_alert: true });
    return;
  }
  if (!roleAllowed(item, user)) {
    await bot.answerCallbackQuery(query.id, { text: '⛔️ این گزینه برای نقش شما در دسترس نیست.', show_alert: true });
    return;
  }
  await bot.answerCallbackQuery(query.id);
  session.clear(chat.id);
  if (isMenuMessage(query.message)) await deleteMenuMessage(bot, query.message); // H2: بعد از انتخاب، پیام منو پاک می‌شود
  // در بله به‌جای web_app خام، handler لینک امضاشده‌ی مخصوص همان پلتفرم را می‌فرستد.
  if (item.url && bot.platform !== 'bale') {
    // H3: آیتم web_app که به‌جای دکمه‌ی web_app callback شده (MINI_APP_URL بدون https) یا دکمه‌ی قدیمی: https ⇒ دکمه‌ی inline web_app؛ وگرنه راهنمای ادمین
    await sendWebAppLink(bot, chat.id, item);
    return;
  }
  const fn = (handlers || defaultHandlers())[item.handler];
  await fn(bot, { chat, from: query.from, text: item.label });
}

module.exports = { ITEMS, MENU_LABEL, normalizeLabel, buildMainKeyboard, buildMenuInline, sendMenu, routeMenuText, handleMenuCallback, defaultHandlers };
