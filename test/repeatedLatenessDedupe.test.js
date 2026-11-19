// هشدار «تأخیر مکرر» به سرپرست بعد از ری‌استارت سرور (حافظه‌ی خالی) دوباره نمی‌رود: ردپای ممیزی همان ماه جلوی آن را می‌گیرد
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

describe('hasEmployeeEventSince', () => {
  let audit; let F;
  before(() => { resetDb(); audit = require('../src/repositories/auditRepository'); F = require('./helpers/factories'); });
  after(() => cleanup());

  test('فقط برای همان سرپرست، همان کارمند و همان عمل و از تاریخ شروع true می‌شود', () => {
    const mgr = F.makeUser(); const emp = F.makeUser(); const other = F.makeUser();
    const q = (o) => audit.hasEmployeeEventSince({ userId: mgr.id, action: 'manager_alerted_repeated_lateness', employeeId: emp.id, sinceDate: '2000-01-01', ...o });
    assert.equal(q(), false);
    audit.logEvent({ userId: mgr.id, action: 'manager_alerted_repeated_lateness', details: { employeeId: emp.id, lateCount: 3 } });
    assert.equal(q(), true);
    assert.equal(q({ employeeId: other.id }), false);
    assert.equal(q({ action: 'x' }), false);
    assert.equal(q({ sinceDate: '2999-01-01' }), false);
  });
});
