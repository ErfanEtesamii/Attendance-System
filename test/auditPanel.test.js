// S4-2b: صفحه‌ی «گزارش رویدادها» — diff خوانای قبل/بعد برای ورودی‌های جدید (logChange)، نمایش ساده‌ی قدیمی، فیلتر موجودیت، دکمه‌ی CSV.
// اجرای واقعی views-admin.js با AP ساختگی (بدون مرورگر)؛ تست دستی مرورگر در گزارش S4-2b آمده است.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

describe('صفحه‌ی گزارش رویدادها (S4-2b)', () => {
  function loadAudit(rows) {
    const esc = (v) => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    const calls = [];
    const AP = {
      views: {}, nav: [], state: { isAdmin: true },
      $: () => null, $$: () => [], esc,
      fmt: { num: (n) => String(n), dateLong: (d) => d, dateTime: (d) => d, date: (d) => d, clock: (d) => d, min: (m) => `${m}m` },
      icon: () => '', badge: (cls, text) => `<span class="badge ${cls}">${esc(text)}</span>`,
      view(id, def) { AP.views[id] = def; if (def.nav) AP.nav.push({ id, ...def.nav }); },
      api: async (p) => { calls.push(p); return p.startsWith('/admin/audit-actions') ? [] : rows; },
      loadUsers: async () => [],
    };
    const src = fs.readFileSync(path.join(__dirname, '..', 'public-admin', 'js', 'views-admin.js'), 'utf8');
    vm.runInNewContext(src, { window: { AP }, document: {}, console, URLSearchParams, CSS: { escape: (s) => s } });
    return { AP, calls };
  }
  const row = (id, action, details) => ({ id, user_id: 1, action, occurred_at: '2026-10-07 10:00:00', ip_address: '192.168.10.5', details, userFullName: 'ادمین' });

  test('ورودی جدید: موجودیت/شناسه، فیلد فارسی با قبل ⇒ بعد، دلیل، متن خام؛ همه‌ی مقدارها escape می‌شوند', async () => {
    const d = JSON.stringify({ source: 'admin_panel', entityType: 'user', entityId: 12, changes: { role: { before: 'employee', after: 'manager' }, is_active: { before: 1, after: 0 }, department: { before: null, after: '<img src=x onerror=1>' } }, reason: 'ارتقا', redacted: ['api_token'] });
    const { AP, calls } = loadAudit([row(1, 'employee_profile_edited', d)]);
    const { html } = await AP.views.audit.render();
    assert.match(html, /کاربر <span class="ltr muted">#12<\/span>/);
    assert.match(html, /<span class="diff-field">نقش<\/span><span class="diff-before">employee<\/span><span class="diff-arrow">←<\/span><span class="diff-after">manager<\/span>/);
    assert.match(html, /<span class="diff-before">فعال<\/span>.*<span class="diff-after">غیرفعال<\/span>/s, 'is_active خوانا');
    assert.match(html, /<span class="diff-before"><span class="muted">—<\/span><\/span>/, 'null ⇒ خط تیره');
    assert.ok(!html.includes('<img src=x'), 'XSS: تگ خام وارد نمی‌شود');
    assert.ok(html.includes('&lt;img src=x onerror=1&gt;'));
    assert.match(html, /دلیل: ارتقا/);
    assert.match(html, /فیلد حساس تغییر کرد.*api_token/s);
    assert.match(html, /<details class="diff-raw">/);
    assert.ok(calls[0].startsWith('/admin/audit-log?'));
  });

  test('ورودی قدیمی (متن ساده، JSON بدون changes، JSON خراب، null) همان جعبه‌ی متنی ساده؛ changes خالی ⇒ «بدون تغییر»', async () => {
    const rows = [
      row(1, 'legacy_text', 'متن ساده'),
      row(2, 'legacy_json', JSON.stringify({ source: 'admin_panel', targetUserId: 5 })),
      row(3, 'broken', '{"entityType":"user","changes":'),
      row(4, 'empty', null),
      row(5, 'no_change', JSON.stringify({ entityType: 'settings', entityId: null, changes: {} })),
    ];
    const { AP } = loadAudit(rows);
    const { html } = await AP.views.audit.render();
    assert.equal((html.match(/class="diff"/g) || []).length, 1, 'فقط ردیف جدید diff می‌شود');
    assert.ok(html.includes('<div class="details-box">متن ساده</div>'));
    assert.ok(html.includes('<div class="details-box">{&quot;source&quot;:&quot;admin_panel&quot;,&quot;targetUserId&quot;:5}</div>'));
    assert.ok(html.includes('<div class="details-box">{&quot;entityType&quot;:&quot;user&quot;,&quot;changes&quot;:</div>'));
    assert.match(html, /تنظیمات.*بدون تغییر در فیلدها/s);
  });

  test('فیلتر موجودیت و دکمه‌ی CSV در صفحه هست؛ مقدار طولانی کوتاه می‌شود', async () => {
    const long = 'x'.repeat(500);
    const { AP } = loadAudit([row(1, 'holidays_imported', JSON.stringify({ entityType: 'holiday', entityId: null, changes: { added: { before: null, after: [long] } } }))]);
    const { html } = await AP.views.audit.render();
    assert.match(html, /<select name="entityType"><option value="">همه<\/option>.*<option value="settings" >تنظیمات<\/option>/s);
    assert.match(html, /<a class="btn ghost" href="\/api\/admin\/audit-log\/export\?[^"]*" download>/);
    assert.ok(html.includes('…'), 'مقدار بلند با … کوتاه می‌شود');
    assert.ok(!new RegExp('x{300}').test(html.split('diff-raw')[0]), 'در diff بیش از ۲۰۰ نویسه نمی‌آید');
  });
});
