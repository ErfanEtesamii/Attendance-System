// حالت مکالمات چندمرحله‌ای بات (مثلاً /leave، /add_employee، /fix_record) را در حافظه نگه می‌دارد.
// چون این حالت فقط برای طول یک مکالمه کوتاه لازم است (نه یک رکورد دائمی)، عمداً در دیتابیس
// ذخیره نمی‌شود؛ در صورت ری‌استارت سرویس (NSSM) کاربر باید مکالمه ناتمام را از نو شروع کند.

const SESSION_TTL_MS = 10 * 60 * 1000; // بعد از ۱۰ دقیقه بی‌پاسخی، مکالمه منقضی می‌شود
const sessions = new Map(); // key: chatId -> { flow, step, data, updatedAt }

function start(chatId, flow, initialData = {}) {
  sessions.set(chatId, { flow, step: 0, data: initialData, updatedAt: Date.now() });
}

function get(chatId) {
  const session = sessions.get(chatId);
  if (!session) return null;
  if (Date.now() - session.updatedAt > SESSION_TTL_MS) {
    sessions.delete(chatId);
    return null;
  }
  return session;
}

function update(chatId, patch) {
  const session = sessions.get(chatId);
  if (!session) return null;
  Object.assign(session, patch, { updatedAt: Date.now() });
  return session;
}

function clear(chatId) {
  sessions.delete(chatId);
}

module.exports = { start, get, update, clear };
