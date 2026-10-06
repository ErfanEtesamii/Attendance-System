// نبض polling بات (بخش ۲-ج۱). node-telegram-bot-api هر چرخه‌ی long-poll را با bot.getUpdates انجام می‌دهد؛
// با پیچیدن همان متد، آخرین موفقیت/خطای واقعی polling را می‌دانیم (نه صرفاً «پروسه زنده است»).
// در حالت فقط-API (src/server.js بدون بات) instrumentBot صدا زده نمی‌شود و بررسی «اعمال‌نشدنی» است، نه خراب.

const { sanitizeText } = require('./sanitize');

const state = {
  attachedAt: null,
  lastSuccessAt: null,
  lastErrorAt: null,
  lastError: null,
  consecutiveErrors: 0,
};

function recordSuccess(now = Date.now()) {
  state.lastSuccessAt = now;
  state.consecutiveErrors = 0;
}

function recordError(err, now = Date.now()) {
  state.lastErrorAt = now;
  state.lastError = sanitizeText(err && err.message ? err.message : err, 300);
  state.consecutiveErrors += 1;
}

function instrumentBot(bot, now = Date.now()) {
  if (!bot || typeof bot.getUpdates !== 'function' || bot.__healthInstrumented) return;
  bot.__healthInstrumented = true;
  state.attachedAt = now;
  const original = bot.getUpdates.bind(bot);
  bot.getUpdates = (...args) =>
    original(...args).then(
      (result) => {
        recordSuccess();
        return result;
      },
      (err) => {
        recordError(err);
        throw err;
      }
    );
}

function getPollingStatus({ staleSeconds = 120, now = Date.now() } = {}) {
  if (state.attachedAt === null) return { applicable: false, ok: true };
  const reference = state.lastSuccessAt !== null ? state.lastSuccessAt : state.attachedAt;
  const ageSeconds = Math.round((now - reference) / 1000);
  const ok = ageSeconds <= staleSeconds;
  return {
    applicable: true,
    ok,
    lastSuccessAt: state.lastSuccessAt ? new Date(state.lastSuccessAt).toISOString() : null,
    lastErrorAt: state.lastErrorAt ? new Date(state.lastErrorAt).toISOString() : null,
    lastError: state.lastError,
    consecutiveErrors: state.consecutiveErrors,
    secondsSinceLastSuccess: state.lastSuccessAt !== null ? ageSeconds : null,
  };
}

// فقط برای تست
function _reset() {
  state.attachedAt = null;
  state.lastSuccessAt = null;
  state.lastErrorAt = null;
  state.lastError = null;
  state.consecutiveErrors = 0;
}

module.exports = { instrumentBot, recordSuccess, recordError, getPollingStatus, _reset };
