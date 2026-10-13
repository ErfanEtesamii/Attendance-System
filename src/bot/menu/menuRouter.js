// E1/E2 (فاز ۱۰): منوی دکمه‌ایِ نقش‌محور بات.
//   • buildMainKeyboard(user): کیبورد ثابت پایین چت (۲ ستونه، فقط چت خصوصی، web_app فقط روی https).
//   • routeMenuText(bot, msg): تشخیص متنِ دکمه با «تطبیق دقیق» (نرمال‌سازی ی/ک، حذف ایموجی و فاصله‌ی اضافه) و اتصال آن
//     به handlerهای موجود — بدون کپی منطق. نقش هر بار از دیتابیس خوانده و سمت سرور دوباره چک می‌شود؛
//     یعنی ارسال دستیِ متنِ یک دکمه‌ی ادمین توسط کارمند اجرا نمی‌شود.
// کاربر ثبت‌نشده منو ندارد.

const session = require('../session');
const { getRegisteredUser, notRegisteredMessage, hasRole } = require('../auth');
const panelLinks = require('../panelLinks');

const MANAGER_UP = ['manager', 'admin'];
const ADMIN_ONLY = ['admin'];

// roles = null ⇒ هر کاربر ثبت‌شده. url = تابعِ آدرسِ web_app (دکمه‌ی web_app، نه متنی).
// ترتیب آرایه همان ترتیب نمایش است: کارمند، سپس افزوده‌های سرپرست، سپس افزوده‌های ادمین (ادمین همه را دارد).
const ITEMS = [
  { id: 'checkin', label: '🕒 ثبت تردد', roles: null, url: () => panelLinks.miniAppLink() },
  { id: 'status', label: '📊 وضعیت من', roles: null, handler: 'status' },
  { id: 'report', label: '📈 گزارش من', roles: null, handler: 'report' },
  { id: 'leave', label: '🏖 مرخصی / 🚗 ماموریت', roles: null, handler: 'leave' },
  { id: 'plan', label: '📋 برنامه هفتگی', roles: null, url: () => panelLinks.miniAppLink({ view: 'plan' }) },
  { id: 'panel', label: '🖥 پنل', roles: null, handler: 'panel' },
  { id: 'help', label: '❓ راهنما', roles: null, handler: 'help' },

  { id: 'team_report', label: '👥 گزارش تیم', roles: MANAGER_UP, handler: 'teamReport' },
  { id: 'pending_leaves', label: '📥 درخواست‌های منتظر', roles: MANAGER_UP, handler: 'pendingLeaves' },
  { id: 'pending_disputes', label: '💬 اعتراض‌ها', roles: MANAGER_UP, handler: 'pendingDisputes' },
  { id: 'yesterday_reports', label: '📝 گزارش‌های دیروز تیم', roles: MANAGER_UP, handler: 'yesterdayReports' },
  { id: 'list_members', label: '👤 لیست اعضا', roles: MANAGER_UP, handler: 'listEmployees' },

  { id: 'add_employee', label: '➕ افزودن کارمند', roles: ADMIN_ONLY, handler: 'addEmployee' },
  { id: 'fix_record', label: '🛠 اصلاح رکورد', roles: ADMIN_ONLY, handler: 'fixRecord' },
  { id: 'admin_panel', label: '⚙️ پنل مدیریت', roles: ADMIN_ONLY, url: () => panelLinks.panelUrl() },
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

function roleAllowed(item, user) {
  return !item.roles || hasRole(user, item.roles);
}

/** دکمه‌های قابل‌نمایش برای کاربر (web_app فقط وقتی آدرس https دارد). */
function itemsFor(user) {
  if (!user) return [];
  return ITEMS.filter((it) => roleAllowed(it, user) && (!it.url || panelLinks.canUseWebApp(it.url())));
}

/**
 * کیبورد ثابتِ منوی اصلی؛ ۲ ستونه. null برای کاربر ثبت‌نشده و برای چت غیرخصوصی (وقتی chatType داده شود).
 * کارمند: ثبت تردد، وضعیت من، گزارش من، مرخصی/ماموریت، برنامه هفتگی، پنل، راهنما — سرپرست: + ابزار تیم — ادمین: + مدیریت.
 */
function buildMainKeyboard(user, { chatType } = {}) {
  if (chatType && chatType !== 'private') return null;
  const items = itemsFor(user);
  if (items.length === 0) return null;
  const buttons = items.map((it) => (it.url ? { text: it.label, web_app: { url: it.url() } } : { text: it.label }));
  const rows = [];
  for (let i = 0; i < buttons.length; i += 2) rows.push(buttons.slice(i, i + 2));
  return { keyboard: rows, resize_keyboard: true, is_persistent: true };
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
    help: require('../commands/help').handleHelp,
    teamReport: require('../commands/teamReport').handleTeamReport,
    pendingLeaves: require('../commands/pendingLeaves').handlePendingLeaves,
    pendingDisputes: require('../commands/pendingDisputes').handlePendingDisputes,
    listEmployees: require('../commands/listEmployees').handleListEmployees,
    addEmployee: require('../commands/addEmployee').handleAddEmployeeCommand,
    fixRecord: require('../commands/fixRecord').handleFixRecordCommand,
    yesterdayReports: sendTeamReportsLink,
  };
}

// دکمه‌ی web_app اگر به‌جای لمس، متنش تایپ شود: همان دکمه را به‌صورت inline می‌فرستیم.
async function sendWebAppLink(bot, chatId, item) {
  const url = item.url();
  if (!panelLinks.canUseWebApp(url)) {
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

  session.clear(chatId); // دکمه‌ی منو = شروع تازه؛ مکالمه‌ی قبلی (مثلاً ثبت مرخصیِ نیمه‌کاره) لغو می‌شود
  if (item.url) {
    await sendWebAppLink(bot, chatId, item);
    return true;
  }
  const fn = (handlers || defaultHandlers())[item.handler];
  await fn(bot, msg);
  return true;
}

/**
 * دکمه‌ی inline «mn:<id>» (مثلاً «📥 درخواست‌های منتظر» زیر اعلان درخواست مرخصی) ⇒ همان handlerِ دکمه‌ی منو.
 * نقش هر بار از دیتابیس خوانده می‌شود؛ دکمه‌ی ناشناخته/web_app ⇒ «این دکمه منقضی شده». هر callback دقیقاً یک‌بار answer می‌شود.
 */
async function handleMenuCallback(bot, query, handlers) {
  const id = String(query.data || '').slice(3);
  const item = ITEMS.find((it) => it.id === id && !it.url);
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
  const fn = (handlers || defaultHandlers())[item.handler];
  await fn(bot, { chat, from: query.from, text: item.label });
}

module.exports = { ITEMS, normalizeLabel, buildMainKeyboard, routeMenuText, handleMenuCallback, defaultHandlers };
