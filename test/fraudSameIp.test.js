// S2-4c: قاعده‌ی ب (دو کاربر با یک IP و ثبت در کمتر از N ثانیه) — تابع خالص، بدون DB.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const {
  detectSameIpClose,
  EVENT_SAME_IP_CLOSE,
  DEFAULT_SAME_IP_WINDOW_SECONDS,
} = require('../src/utils/fraudDetection');

const IP1 = '192.168.10.21';
const IP2 = '192.168.10.22';
const DAY = '2026-10-01';
// زمان ISO سمت سرور؛ sec = ثانیه‌ی بعد از 08:00:00Z
const at = (sec) => new Date(Date.UTC(2026, 9, 1, 8, 0, 0) + sec * 1000).toISOString();
const rec = (id, user_id, inSec, inIp, outSec = null, outIp = null, record_date = DAY) => ({
  id,
  user_id,
  record_date,
  check_in_time: inSec === null ? null : at(inSec),
  check_in_ip: inIp,
  check_out_time: outSec === null ? null : at(outSec),
  check_out_ip: outIp,
});

describe('detectSameIpClose (S2-4c)', () => {
  test('مثبت: دو کاربر با یک IP و فاصله‌ی کمتر از N ⇒ یک نشانه با شکل ورودی repository', () => {
    const out = detectSameIpClose([rec(11, 2, 30, IP1), rec(10, 1, 0, IP1)]);
    assert.equal(out.length, 1);
    assert.equal(out[0].eventType, EVENT_SAME_IP_CLOSE);
    assert.deepEqual(out[0].userIds, [1, 2]);
    assert.deepEqual(out[0].recordIds, [10, 11]);
    assert.equal(out[0].eventDate, DAY);
    assert.deepEqual(out[0].details, {
      rule: 'B', ip: IP1, windowSeconds: DEFAULT_SAME_IP_WINDOW_SECONDS, minGapSeconds: 30, userCount: 2,
    });

    // خروج یکی و ورود دیگری هم دیده می‌شود؛ پیشوند IPv6-mapped با IP ساده یکی است
    const mixed = detectSameIpClose([rec(1, 1, 0, '1.1.1.1', 3600, `::ffff:${IP1}`), rec(2, 2, 3620, IP1)]);
    assert.equal(mixed.length, 1);
    assert.deepEqual(mixed[0].userIds, [1, 2]);
    assert.equal(mixed[0].details.ip, IP1);

    // زنجیره‌ی A-B و B-C (A-C دورتر از N) ⇒ یک رویداد سه‌نفره
    const chain = detectSameIpClose([rec(1, 1, 0, IP1), rec(2, 2, 50, IP1), rec(3, 3, 100, IP1)]);
    assert.equal(chain.length, 1);
    assert.deepEqual(chain[0].userIds, [1, 2, 3]);
  });

  test('منفی: IP متفاوت، فاصله‌ی زیاد، روز متفاوت، یک کاربر، یا IP/زمان خالی/نامعتبر ⇒ هیچ', () => {
    assert.deepEqual(detectSameIpClose([rec(1, 1, 0, IP1), rec(2, 2, 5, IP2)]), []);
    assert.deepEqual(detectSameIpClose([rec(1, 1, 0, IP1), rec(2, 2, 600, IP1)]), []);
    assert.deepEqual(detectSameIpClose([rec(1, 1, 0, IP1, null, null, '2026-10-01'),
      rec(2, 2, 5, IP1, null, null, '2026-10-02')]), []);
    // یک کاربر با چند ثبت پشت‌سرهم از یک IP نشانه نمی‌سازد
    assert.deepEqual(detectSameIpClose([rec(1, 1, 0, IP1, 10, IP1)]), []);
    // ثبت‌های بات/دستی (IP خالی) یا زمان خراب نادیده گرفته می‌شود
    assert.deepEqual(detectSameIpClose([rec(1, 1, 0, null), rec(2, 2, 5, null)]), []);
    assert.deepEqual(detectSameIpClose([rec(1, 1, 0, IP1), { ...rec(2, 2, 5, IP1), check_in_time: 'not-a-date' }]), []);
  });

  test('مرز و N سفارشی: دقیقاً N ⇒ هیچ، N-1 ثانیه ⇒ نشانه؛ windowSeconds رعایت می‌شود؛ نامعتبر ⇒ پیش‌فرض', () => {
    const N = DEFAULT_SAME_IP_WINDOW_SECONDS;
    assert.deepEqual(detectSameIpClose([rec(1, 1, 0, IP1), rec(2, 2, N, IP1)]), []);
    assert.equal(detectSameIpClose([rec(1, 1, 0, IP1), rec(2, 2, N - 1, IP1)]).length, 1);

    const pair = (gap) => [rec(1, 1, 0, IP1), rec(2, 2, gap, IP1)];
    assert.deepEqual(detectSameIpClose(pair(30), { windowSeconds: 10 }), []);
    assert.deepEqual(detectSameIpClose(pair(10), { windowSeconds: 10 }), []);
    const wide = detectSameIpClose(pair(250), { windowSeconds: 300 });
    assert.equal(wide.length, 1);
    assert.equal(wide[0].details.windowSeconds, 300);
    assert.equal(wide[0].details.minGapSeconds, 250);

    for (const bad of [0, -5, NaN, 'abc', null, undefined]) {
      assert.equal(detectSameIpClose(pair(30), { windowSeconds: bad }).length, 1, `windowSeconds=${bad}`);
      assert.deepEqual(detectSameIpClose(pair(90), { windowSeconds: bad }), [], `windowSeconds=${bad}`);
    }
  });

  test('ورودی خراب ⇒ استثنا نمی‌دهد؛ ورودی تغییر نمی‌کند؛ خروجی قطعی و مرتب', () => {
    assert.deepEqual(detectSameIpClose(null), []);
    assert.deepEqual(detectSameIpClose([null, {}, rec(1, 'x', 0, IP1), rec(2, 2, 1, IP1)]), []);

    const input = [
      rec(4, 2, 5, IP2, null, null, '2026-10-02'), rec(3, 1, 0, IP2, null, null, '2026-10-02'),
      rec(2, 2, 5, IP1), rec(1, 1, 0, IP1),
    ];
    const copy = JSON.parse(JSON.stringify(input));
    const out = detectSameIpClose(input);
    assert.deepEqual(input, copy);
    assert.deepEqual(out.map((e) => e.eventDate), ['2026-10-01', '2026-10-02']);
    assert.deepEqual(detectSameIpClose(input.slice().reverse()), out);
  });
});
