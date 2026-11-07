// سازگارکننده‌ی کوچک API بله با سطح API مورد استفاده‌ی بات پروژه.
// بله در عمده‌ی Bot API با تلگرام هم‌ساخت است، اما کلاینت Node رسمیِ
// تلگرام را نمی‌توان به endpoint بله متصل کرد؛ این ماژول polling و درخواست‌ها
// را مستقیماً به tapi.bale.ai انجام می‌دهد.
const { EventEmitter } = require('events');
const { Readable } = require('stream');

const API_ROOT = 'https://tapi.bale.ai';

class BaleBot extends EventEmitter {
  constructor(token, { polling = false, pollTimeout = 30 } = {}) {
    super();
    if (!token) throw new Error('BALE_BOT_TOKEN تنظیم نشده است.');
    this.token = token;
    this.platform = 'bale';
    this.pollTimeout = pollTimeout;
    this.offset = 0;
    this.stopped = false;
    if (polling) this.startPolling();
  }

  apiUrl(method) {
    return `${API_ROOT}/bot${this.token}/${method}`;
  }

  async call(method, params = {}) {
    const response = await fetch(this.apiUrl(method), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(params),
    });
    let payload;
    try { payload = await response.json(); } catch (_) { payload = null; }
    if (!response.ok || !payload || !payload.ok) {
      const message = payload?.description || `Bale API ${method} failed (${response.status})`;
      const error = new Error(message);
      error.code = payload?.error_code || response.status;
      error.response = payload;
      throw error;
    }
    return payload.result;
  }

  // در بله web_app به لینک یک‌بارمصرف (url) تبدیل می‌شود: /admin/ ⇒ توکن پنل (t)، غیر از آن ⇒ توکن مینی‌اپ (bale_token).
  // فقط چت خصوصی با کاربر ثبت‌شده؛ در غیر این صورت دکمه حذف می‌شود. فیلدهای نمایشی اختصاصی تلگرام (style) هم حذف می‌شوند.
  webAppToUrlButton(button, chatId) {
    let target;
    try { target = new URL(button.web_app.url); } catch (_) { return null; }
    if (target.protocol !== 'https:') return null;
    const usersRepository = require('../repositories/usersRepository');
    const codes = require('../utils/panelLoginCodes');
    const user = chatId == null ? null : usersRepository.findByTelegramId(String(chatId));
    if (!user || !user.is_active) return null;
    if (target.pathname.startsWith('/admin/')) target.searchParams.set('t', codes.issueLinkToken(user.id).token);
    else target.searchParams.set('bale_token', codes.issueMiniAppToken(user.id).token);
    const { web_app: _w, ...rest } = button;
    return { ...rest, url: target.toString() };
  }

  normalizeMarkup(markup, chatId) {
    if (!markup || typeof markup !== 'object') return markup;
    const clone = JSON.parse(JSON.stringify(markup));
    if (Array.isArray(clone.inline_keyboard)) {
      clone.inline_keyboard = clone.inline_keyboard
        .map((row) => row
          .map((button) => {
            delete button.style;
            return button.web_app ? this.webAppToUrlButton(button, chatId) : button;
          })
          .filter(Boolean))
        .filter((row) => row.length > 0);
    }
    return clone;
  }

  async sendMessage(chatId, text, options = {}) {
    return this.call('sendMessage', {
      chat_id: chatId,
      text,
      ...options,
      ...(options.reply_markup ? { reply_markup: JSON.stringify(this.normalizeMarkup(options.reply_markup, chatId)) } : {}),
    });
  }

  async answerCallbackQuery(id, options = {}) {
    return this.call('answerCallbackQuery', { callback_query_id: id, ...options });
  }

  async editMessageReplyMarkup(markup, options = {}) {
    return this.call('editMessageReplyMarkup', {
      chat_id: options.chat_id,
      message_id: options.message_id,
      reply_markup: JSON.stringify(this.normalizeMarkup(markup, options.chat_id)),
    });
  }

  async editMessageText(text, options = {}) {
    return this.call('editMessageText', {
      chat_id: options.chat_id,
      message_id: options.message_id,
      text,
      ...(options.reply_markup ? { reply_markup: JSON.stringify(this.normalizeMarkup(options.reply_markup, options.chat_id)) } : {}),
    });
  }

  deleteMessage(chatId, messageId) { return this.call('deleteMessage', { chat_id: chatId, message_id: messageId }); }
  getUpdates(options = {}) { return this.call('getUpdates', options); }
  deleteWebhook() { return this.call('deleteWebhook'); }
  // بله منوی فرمانِ تلگرام ندارد؛ برای سازگاری با راه‌اندازی قبلی عمداً no-op است.
  async setMyCommands() { return true; }

  // نشانگر «در حال تایپ»؛ شکستش نباید جریان اصلی را بشکند.
  async sendChatAction(chatId, action = 'typing') {
    try { return await this.call('sendChatAction', { chat_id: chatId, action }); } catch (_) { return true; }
  }

  async sendDocument(chatId, document, options = {}, fileOptions = {}) {
    // گزارش‌های ماهانه از Buffer ارسال می‌شوند؛ برای آن multipart لازم است.
    if (Buffer.isBuffer(document) || document instanceof Uint8Array) {
      const form = new FormData();
      form.set('chat_id', String(chatId));
      form.set('document', new Blob([document], { type: fileOptions.contentType || 'application/octet-stream' }), fileOptions.filename || 'report.xlsx');
      for (const [key, value] of Object.entries(options || {})) {
        if (value !== undefined) form.set(key, key === 'reply_markup' ? JSON.stringify(this.normalizeMarkup(value, chatId)) : String(value));
      }
      const response = await fetch(this.apiUrl('sendDocument'), { method: 'POST', body: form });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.description || 'Bale API sendDocument failed');
      return payload.result;
    }
    return this.call('sendDocument', { chat_id: chatId, document, ...options });
  }

  async getFileStream(fileId) {
    const file = await this.call('getFile', { file_id: fileId });
    if (!file?.file_path) throw new Error('مسیر فایل پیوست از بله دریافت نشد.');
    const response = await fetch(`${API_ROOT}/file/bot${this.token}/${file.file_path}`);
    if (!response.ok || !response.body) throw new Error('دانلود فایل پیوست از بله ناموفق بود.');
    return Readable.fromWeb(response.body);
  }

  onText(regex, listener) {
    this.on('message', (message) => {
      if (typeof message?.text === 'string') {
        regex.lastIndex = 0;
        if (regex.test(message.text)) listener(message);
      }
    });
  }

  async startPolling() {
    try { await this.deleteWebhook(); } catch (err) { this.emit('polling_error', err); }
    while (!this.stopped) {
      try {
        const updates = await this.getUpdates({ offset: this.offset, timeout: this.pollTimeout, limit: 100 });
        for (const update of updates || []) {
          this.offset = Math.max(this.offset, Number(update.update_id || 0) + 1);
          if (update.message) this.emit('message', update.message);
          if (update.callback_query) this.emit('callback_query', update.callback_query);
        }
      } catch (err) {
        this.emit('polling_error', err);
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
    }
  }

  stopPolling() { this.stopped = true; }
}

module.exports = BaleBot;
