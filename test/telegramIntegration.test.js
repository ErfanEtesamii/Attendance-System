const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const Integration = require('../public/js/telegramIntegration.js');

function documentMock() {
  const values = {};
  return { values, documentElement: { style: { setProperty: (key, value) => { values[key] = value; } } } };
}

describe('Telegram WebApp integration', () => {
  test('بدون SDK یا APIهای اختیاری هیچ خطایی نمی‌دهد', async () => {
    const doc = documentMock();
    const api = Integration.create(null, doc);
    assert.doesNotThrow(() => api.init());
    assert.doesNotThrow(() => api.impact());
    assert.doesNotThrow(() => api.notify('success'));
    assert.doesNotThrow(() => api.setBackHandler(() => {}));
    assert.equal(await api.ask('تأیید؟', () => true), true);
    assert.equal(doc.values['--tg-safe-top'], '0px');
  });

  test('ready/expand/swipes، safe area و رویدادهای تغییر را وصل می‌کند', () => {
    const calls = []; const handlers = {}; const doc = documentMock();
    const tg = {
      safeAreaInset: { top: 10, right: 2, bottom: 14, left: 3 },
      contentSafeAreaInset: { top: 5, bottom: 8 },
      ready: () => calls.push('ready'), expand: () => calls.push('expand'),
      disableVerticalSwipes: () => calls.push('swipes'),
      onEvent: (name, handler) => { handlers[name] = handler; },
    };
    Integration.create(tg, doc).init();
    assert.deepEqual(calls, ['ready', 'expand', 'swipes']);
    assert.equal(doc.values['--tg-safe-top'], '10px');
    assert.equal(doc.values['--tg-content-safe-bottom'], '8px');
    tg.safeAreaInset.top = 18; handlers.safeAreaChanged();
    assert.equal(doc.values['--tg-safe-top'], '18px');
  });

  test('هپتیک، BackButton و confirm را در صورت پشتیبانی فراخوانی می‌کند', async () => {
    const calls = []; let back; let confirmed;
    const tg = {
      HapticFeedback: { impactOccurred: (x) => calls.push(['impact', x]), notificationOccurred: (x) => calls.push(['notify', x]) },
      BackButton: { onClick: (fn) => { back = fn; }, show: () => calls.push(['back', 'show']), hide: () => calls.push(['back', 'hide']) },
      showConfirm: (_message, done) => { confirmed = done; },
    };
    const api = Integration.create(tg, documentMock());
    api.impact('medium'); api.notify('success');
    let returned = false; api.setBackHandler(() => { returned = true; }); back();
    const pending = api.ask('مطمئن؟', () => false); confirmed(true);
    assert.equal(await pending, true);
    assert.equal(returned, true);
    api.setBackHandler(null);
    assert.deepEqual(calls, [['impact', 'medium'], ['notify', 'success'], ['back', 'show'], ['back', 'hide']]);
  });

  test('خطای showConfirm به fallback داخلی برمی‌گردد', async () => {
    const api = Integration.create({ showConfirm() { throw new Error('unsupported'); } }, documentMock());
    assert.equal(await api.ask('تأیید؟', async () => true), true);
  });
});
