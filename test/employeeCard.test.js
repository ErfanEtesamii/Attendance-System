// کارتکس کارمند: ساخت شیت اختصاصی هر کارمند (مشخصات بالا + همه‌ی روزهای بازه + جمع کل) بدون تکرار نام/کد در ردیف‌ها
process.env.TZ = 'Asia/Tehran';
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { buildCardSheets, CARD_HEADERS } = require('../src/services/employeeCardService');

const report = {
  from: '2026-11-01', to: '2026-11-05',
  users: [{
    user: { id: 7, fullName: 'هادی حجازی', personnelCode: '502', department: 'حسابداری' },
    days: [
      { date: '2026-11-01', status: 'present', breakPaid: 10, breakUnpaid: 20, effective: 480, late: 0 },
      { date: '2026-11-02', status: 'late', breakPaid: 0, breakUnpaid: 30, effective: 450, late: 12 },
      { date: '2026-11-03', status: 'incomplete', breakPaid: 0, breakUnpaid: 0, effective: 0, late: 0 },
      { date: '2026-11-04', status: 'absent' },
      { date: '2026-11-05', status: 'weekend' },
    ],
  }],
};
const records = [
  { user_id: 7, record_date: '2026-11-01', check_in_time: '2026-11-01T04:21:00.000Z', check_out_time: '2026-11-01T13:51:00.000Z', check_in_ip: '::ffff:10.0.0.5', check_out_ip: '::ffff:10.0.0.5' },
  { user_id: 7, record_date: '2026-11-02', check_in_time: '2026-11-02T04:42:00.000Z', check_out_time: '2026-11-02T13:30:00.000Z', check_in_ip: '10.0.0.6', check_out_ip: null },
  { user_id: 7, record_date: '2026-11-03', check_in_time: '2026-11-03T04:30:00.000Z', check_out_time: null, check_in_ip: '10.0.0.5', check_out_ip: null },
];

describe('کارتکس کارمند', () => {
  const [sheet] = buildCardSheets({ report, records, timezone: 'Asia/Tehran' });

  test('یک شیت به نام کارمند؛ همه‌ی روزهای بازه؛ ردیف‌ها هم‌طول سرستون', () => {
    assert.equal(sheet.name, 'هادی حجازی');
    assert.deepEqual(sheet.headers, CARD_HEADERS);
    assert.equal(sheet.rows.length, 5);
    for (const r of sheet.rows) assert.equal(r.length, CARD_HEADERS.length);
    assert.ok(!sheet.rows.some((r) => r.includes('502') || r.includes('حسابداری')), 'نام/کد/دپارتمان در ردیف‌ها تکرار نمی‌شود');
  });

  test('مستطیل مشخصات: نام، کد، دپارتمان، IP یکتا، میانگین ورود/خروج (ناقص در میانگین خروج نمی‌آید)', () => {
    const [l1, l2] = sheet.card.lines;
    assert.deepEqual(l1.map((c) => c[0]), ['کارمند:  هادی حجازی', 'کد پرسنلی:  502', 'دپارتمان:  حسابداری']);
    assert.equal(l2[0][0], 'IP:  10.0.0.5، 10.0.0.6');
    assert.equal(l2[1][0], 'میانگین ورود:  08:01'); // ۰۷:۵۱، ۰۸:۱۲، ۰۸:۰۰
    assert.equal(l2[2][0], 'میانگین خروج:  17:11'); // ۱۷:۲۱ و ۱۷:۰۰ (روز بدون خروج حساب نمی‌شود)
    assert.equal(l1.reduce((t, c) => t + c[1], 0), 8);
  });

  test('روزها: حاضر، بدون خروج/ناقص، غیبت، تعطیل؛ جمع کل و رنگ ردیف', () => {
    assert.deepEqual(sheet.rows[0].slice(2), ['07:51', '17:21', 30, 480, 0, 'حاضر']);
    assert.deepEqual(sheet.rows[2].slice(2), ['08:00', 'بدون خروج', 0, '—', 0, 'ناقص']);
    assert.deepEqual(sheet.rows[3].slice(2), ['—', '—', '—', '—', '—', 'غیبت']);
    assert.equal(sheet.rows[4][7], 'تعطیل');
    assert.deepEqual(sheet.rowTones, ['', '', 'incomplete', 'absent', 'holiday']);
    assert.deepEqual(sheet.footer, { label: 'جمع کل', labelSpan: 4, values: [60, 930, 12, '1 روز غیبت'] });
  });
});
