// تب «دورکاری» پروفایل: دسته‌بندی استراحت‌ها نسبت به جلسه‌ی دورکاری
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { classifyBreaks } = require('../src/services/remoteDayDetailService');

const t = (h, m = 0) => Date.UTC(2026, 9, 26, h, m);
const iso = (ms) => new Date(ms).toISOString();
const br = (id, s, e, via = 1) => ({ id, break_type: 'short_break', start_time: iso(s), end_time: e ? iso(e) : null, via_remote: via });

test('استراحت داخل جلسه ⇒ inside_remote؛ بسته‌نشده تا پایان جلسه ⇒ unclosed؛ بیرون با via_remote ⇒ gap؛ بیرون عادی ⇒ onsite', () => {
  const full = [[t(8), t(20)]];
  const credited = [[t(8), t(13)]]; // پس از ۱۳:۰۰ استراحتِ بسته‌نشده
  const k = classifyBreaks([br(1, t(9), t(9, 30)), br(2, t(13), t(20)), br(3, t(6), t(7, 30)), br(4, t(5), t(5, 20), 0)], full, credited).map((x) => x.kind);
  assert.deepEqual(k, ['inside_remote', 'unclosed', 'gap', 'onsite']);
});
