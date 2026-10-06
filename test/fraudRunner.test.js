// S2-4e-1: اجراکننده‌ی قاعده‌های تشخیص (fraudRunner) روی دیتابیس واقعی تست.
// هنوز به ثبت تردد/nightlyReview وصل نیست؛ فقط هسته و پایداری آن (هرگز استثنا نمی‌دهد) تست می‌شود.
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const config = require('../src/config');
const attendanceRepository = require('../src/repositories/attendanceRepository');
const suspiciousRepository = require('../src/repositories/suspiciousRepository');
const fraud = require('../src/utils/fraudDetection');
const { runFraudChecks } = require('../src/utils/fraudRunner');
const { todayDateString } = require('../src/utils/serverTime');
const { makeUser } = require('./helpers/factories');

const D = '2026-10-06';
const SHARED = 'dev-shared-0000000001';
const OLD = 'dev-old-000000000001';
const NEW = 'dev-new-000000000001';

describe('fraudRunner (S2-4e-1)', () => {
  let db; let u1; let u2; let u3;

  function insert({ userId, date, inTime = null, inIp = null, inDev = null, outTime = null, outIp = null, outDev = null }) {
    db.prepare(
      `INSERT INTO attendance_records
         (user_id, record_date, check_in_time, check_in_ip, check_in_device, check_out_time, check_out_ip, check_out_device)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(userId, date, inTime, inIp, inDev, outTime, outIp, outDev);
  }

  // u1+u2 هم‌device (الف)، u2+u3 هم‌IP با ۲۰ ثانیه فاصله (ب)، u3 با سه روز سابقه‌ی OLD و امروز NEW (ج)
  function seedScenario() {
    insert({ userId: u1.id, date: D, inTime: `${D}T08:30:00.000Z`, inIp: '10.0.0.1', inDev: SHARED });
    insert({ userId: u2.id, date: D, inTime: `${D}T08:00:00.000Z`, inIp: '10.0.0.2', inDev: SHARED });
    insert({ userId: u3.id, date: D, inTime: `${D}T08:00:20.000Z`, inIp: '10.0.0.2', inDev: NEW });
    ['2026-10-03', '2026-10-04', '2026-10-05'].forEach((d, i) => {
      insert({ userId: u3.id, date: d, inTime: `${d}T08:00:00.000Z`, inIp: `10.0.1.${i + 1}`, inDev: OLD });
    });
  }

  const count = () => db.prepare('SELECT COUNT(*) n FROM suspicious_events').get().n;

  before(() => { db = resetDb(); });
  after(() => cleanup());
  beforeEach(() => {
    db = resetDb();
    u1 = makeUser(); u2 = makeUser(); u3 = makeUser();
  });

  test('هر سه قاعده اجرا و ثبت می‌شوند؛ اجرای دوباره مورد تکراری نمی‌سازد', () => {
    seedScenario();
    const first = runFraudChecks({ date: D });
    assert.equal(first.ok, true);
    assert.deepEqual(first.errors, []);
    assert.equal(first.date, D);
    assert.equal(first.scanned, 6);
    assert.equal(first.found, 3);
    assert.equal(first.created.length, 3);
    assert.deepEqual(first.created.map((e) => e.event_type).sort(), ['device_change', 'same_ip_close', 'shared_device']);
    const byType = Object.fromEntries(first.created.map((e) => [e.event_type, e]));
    assert.deepEqual(byType.shared_device.user_ids, [u1.id, u2.id].sort((a, b) => a - b));
    assert.deepEqual(byType.same_ip_close.user_ids, [u2.id, u3.id].sort((a, b) => a - b));
    assert.deepEqual(byType.device_change.user_ids, [u3.id]);
    assert.ok(first.created.every((e) => e.event_date === D && e.status === 'open'));

    const second = runFraudChecks({ date: D });
    assert.equal(second.ok, true);
    assert.equal(second.found, 3);
    assert.equal(second.created.length, 0);
    assert.equal(second.duplicates, 3);
    assert.equal(count(), 3);
  });

  test('دامنه‌ی تاریخ و آستانه‌ی قابل‌تنظیم: الف/ب فقط همان روز؛ N از config', () => {
    // روز قبل (داخل پنجره‌ی lookback) هم‌device و هم‌IP نزدیک؛ اجرای روز D نباید آن را نشانه کند
    const prev = '2026-10-05';
    insert({ userId: u1.id, date: prev, inTime: `${prev}T08:00:00.000Z`, inIp: '10.0.0.9', inDev: SHARED });
    insert({ userId: u2.id, date: prev, inTime: `${prev}T08:00:05.000Z`, inIp: '10.0.0.9', inDev: SHARED });
    const forD = runFraudChecks({ date: D });
    assert.equal(forD.scanned, 2);
    assert.equal(forD.found, 0);
    assert.equal(count(), 0);
    // همان روز را مستقیم اجرا کنیم، هر دو نشانه ساخته می‌شود
    const forPrev = runFraudChecks({ date: prev });
    assert.deepEqual(forPrev.created.map((e) => e.event_type).sort(), ['same_ip_close', 'shared_device']);
    assert.ok(forPrev.created.every((e) => e.event_date === prev));

    // N از config.fraud: فاصله‌ی ۲۰ ثانیه با N=10 نشانه نیست، با N=60 هست
    db.exec('DELETE FROM suspicious_events');
    db.exec('DELETE FROM attendance_records');
    insert({ userId: u1.id, date: D, inTime: `${D}T08:00:00.000Z`, inIp: '10.0.0.7', inDev: OLD });
    insert({ userId: u2.id, date: D, inTime: `${D}T08:00:20.000Z`, inIp: '10.0.0.7', inDev: NEW });
    const saved = config.fraud.sameIpWindowSeconds;
    try {
      config.fraud.sameIpWindowSeconds = 10;
      assert.equal(runFraudChecks({ date: D }).found, 0);
      config.fraud.sameIpWindowSeconds = 60;
      const r = runFraudChecks({ date: D });
      assert.equal(r.found, 1);
      assert.equal(r.created[0].event_type, 'same_ip_close');
    } finally {
      config.fraud.sameIpWindowSeconds = saved;
    }
  });

  test('هرگز استثنا نمی‌دهد: خطای قاعده/ثبت/بارگذاری گزارش می‌شود و بقیه ادامه می‌یابد', () => {
    seedScenario();
    const origErr = console.error;
    const origA = fraud.detectSharedDevice;
    const origCreate = suspiciousRepository.create;
    const origLoad = attendanceRepository.listForFraud;
    console.error = () => {};
    try {
      // ۱) قاعده‌ی الف می‌ترکد ⇒ ب و ج همچنان ثبت می‌شوند
      fraud.detectSharedDevice = () => { throw new Error('boom A'); };
      let r;
      assert.doesNotThrow(() => { r = runFraudChecks({ date: D }); });
      assert.equal(r.ok, false);
      assert.deepEqual(r.errors.map((e) => e.stage), ['rule_A']);
      assert.deepEqual(r.created.map((e) => e.event_type).sort(), ['device_change', 'same_ip_close']);
      fraud.detectSharedDevice = origA;

      // ۲) ثبت اولین مورد می‌ترکد ⇒ بقیه‌ی موارد ثبت می‌شوند
      db.exec('DELETE FROM suspicious_events');
      let calls = 0;
      suspiciousRepository.create = (c) => { calls += 1; if (calls === 1) throw new Error('db locked'); return origCreate(c); };
      assert.doesNotThrow(() => { r = runFraudChecks({ date: D }); });
      assert.equal(r.ok, false);
      assert.equal(r.errors.length, 1);
      assert.match(r.errors[0].stage, /_save$/);
      assert.equal(r.created.length, 2);
      suspiciousRepository.create = origCreate;

      // ۳) بارگذاری داده می‌ترکد ⇒ هیچ‌چیز ثبت نمی‌شود، ولی استثنا هم نمی‌آید
      db.exec('DELETE FROM suspicious_events');
      attendanceRepository.listForFraud = () => { throw new Error('disk I/O'); };
      assert.doesNotThrow(() => { r = runFraudChecks({ date: D }); });
      assert.equal(r.ok, false);
      assert.deepEqual(r.errors.map((e) => e.stage), ['load']);
      assert.equal(count(), 0);
    } finally {
      console.error = origErr;
      fraud.detectSharedDevice = origA;
      suspiciousRepository.create = origCreate;
      attendanceRepository.listForFraud = origLoad;
    }
  });

  test('ورودی نامعتبر یا بدون ورودی: بدون استثنا و بدون تغییر DB؛ پیش‌فرض «امروز» سرور', () => {
    const origErr = console.error;
    console.error = () => {};
    try {
      for (const bad of [{ date: '2026-13-45' }, { date: 'امروز' }, { date: 20261006 }, { date: null }]) {
        let r;
        assert.doesNotThrow(() => { r = runFraudChecks(bad); });
        assert.equal(r.ok, false);
        assert.deepEqual(r.errors.map((e) => e.stage), ['input']);
        assert.equal(r.date, null);
      }
    } finally {
      console.error = origErr;
    }
    assert.equal(count(), 0);
    const r = runFraudChecks();
    assert.equal(r.ok, true);
    assert.equal(r.date, todayDateString());
    assert.equal(r.found, 0);
    assert.doesNotThrow(() => runFraudChecks(null));
  });
});
