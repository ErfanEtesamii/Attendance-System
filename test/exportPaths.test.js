// FIX-EXPORT-API-PREFIX: مسیر خروجی‌های پنل باید با /api شروع شود؛ بدون آن درخواست به express.static زیر /admin می‌رسد
// و پاسخ 404 JSON با نام export.json ذخیره می‌شود.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8').replace(/\r\n/g, '\n');

for (const file of ['public-admin/js/views-mystatus.js', 'public-admin/js/views-weekly.js']) {
  test(`${file}: مسیرهای خروجی با /api شروع می‌شوند`, () => {
    const src = read(file);
    const hits = [...src.matchAll(/(?:path:\s*|buildExportUrl\()\s*([`'])(\/[^`']*week\/export)\1/g)];
    assert.ok(hits.length >= 2, 'باید هم exportBar و هم کپی متن مسیر خروجی داشته باشند');
    for (const m of hits) assert.ok(m[2].startsWith('/api/admin/'), `مسیر بدون /api: ${m[2]}`);
  });
}
