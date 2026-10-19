// رگرسیون: در app.js (یک IIFE) تعریف دوباره‌ی یک function هم‌نام، به‌خاطر hoisting تعریف اول را بی‌صدا می‌پوشاند.
// نمونه‌ی واقعی: dEl (ویزارد گزارش) با dEl (اعتراض‌ها) یکی شد و ویزارد خروج فقط «[object HTMLInputElement]…» نشان می‌داد.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('app.js: نام function تکراری ندارد', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'app.js'), 'utf8');
  const seen = new Map();
  const dups = [];
  for (const m of src.matchAll(/^ {2}(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm)) {
    if (seen.has(m[1])) dups.push(m[1]); else seen.set(m[1], true);
  }
  assert.deepEqual(dups, []);
});
