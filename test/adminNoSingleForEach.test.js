'use strict';
// جلوگیری از رگرسیون: $() = querySelector (یک عنصر) و forEach ندارد؛ برای چند عنصر باید $$() استفاده شود.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const dir = path.join(__dirname, '..', 'public-admin', 'js');

test('هیچ فایل ادمین $(...).forEach (روی querySelector) صدا نمی‌زند', () => {
  const bad = [];
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.js'))) {
    fs.readFileSync(path.join(dir, f), 'utf8').split(/\r?\n/).forEach((line, i) => {
      if (/(^|[^$\w])\$\([^)]*\)\.forEach\(/.test(line)) bad.push(`${f}:${i + 1}`);
    });
  }
  assert.deepStrictEqual(bad, []);
});
