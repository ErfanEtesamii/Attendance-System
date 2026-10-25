// Characterization guard for computeDay.  It deliberately uses no database or clock:
// 4,096 deterministic closed-day inputs cover normal/late/early/overnight-adjacent
// timestamps, breaks and the cross-midnight compatibility switch.
const crypto = require('crypto');
const { computeDay } = require('../src/engine/computeDay');
const golden = require('./fixtures/computeDay.golden.json');

const baseSettings = {
  workDayStart: '08:00', workDayEnd: '16:30', lateGraceMinutes: 10, earlyGraceMinutes: 10,
  maxLunchMinutes: 60, fixedLunchDeductMinutes: 0, paidBreakCount: 0, paidBreakMinutes: 0, overtimeEnabled: true, overtimeMinMinutes: 0,
  overtimeDailyCapMinutes: 0, overtimeRoundStep: 1, overtimeRounding: 'down',
  overtimeFactor: 1, overtimeHolidayFactor: 1, outsideShiftMarginMinutes: 120,
};
const iso = (day, minute) => new Date(Date.UTC(2026, 0, day, 0, minute - 210)).toISOString(); // Tehran UTC+3:30
const rows = [];
for (let i = 0; i < 4096; i += 1) {
  const day = 1 + (i % 20);
  const start = 420 + ((i * 37) % 360);
  const duration = 60 + ((i * 53) % 840);
  const out = start + duration;
  const settings = { ...baseSettings, crossMidnightMode: i % 2 ? 'legacy' : 'by_shift_day' };
  const record = { record_date: `2026-01-${String(day).padStart(2, '0')}`, status: i % 29 === 0 ? 'incomplete' : 'normal', check_in_time: iso(day, start), check_out_time: iso(day + Math.floor(out / 1440), out % 1440) };
  const breaks = i % 3 ? [] : [{ start_time: iso(day, start + 30), end_time: iso(day, Math.min(start + 45, out)) }];
  rows.push(computeDay({ record, breaks, settings, timezone: 'Asia/Tehran' }));
}
const digest = crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex');
if (process.argv.includes('--print')) { console.log(JSON.stringify({ cases: rows.length, sha256: digest }, null, 2)); process.exit(0); }
if (golden.cases !== rows.length || golden.sha256 !== digest) {
  console.error(`computeDay characterization drifted: expected ${golden.sha256}, got ${digest}`);
  process.exit(1);
}
console.log(`computeDay characterization passed (${rows.length} cases).`);
