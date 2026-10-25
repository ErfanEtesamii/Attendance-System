// گیت شروع دورکاری از بات: حضوری ← خروج ← دورکاریِ همان روز (بدون نیاز به دیتابیس؛ مخزن‌ها ساختگی‌اند)
const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');
const path = require('path');

const state = { settings: {}, record: null };
const stubs = {
  settingsRepository: { getAll: () => state.settings },
  leaveRepository: { hasApprovedMissionOnDate: () => false },
  attendanceRepository: { findTodayRecord: () => state.record },
};
const origLoad = Module._load;
Module._load = function (request, parent, ...rest) {
  const base = path.basename(request);
  if (parent && /remoteWorkGate\.js$/.test(parent.filename)) {
    if (stubs[base]) return stubs[base];
    if (base === 'pendingMissionService') return { pendingMissionPass: () => false };
  }
  return origLoad.call(this, request, parent, ...rest);
};
const { checkStart } = require('../src/services/remoteWorkGate');
Module._load = origLoad;

const now = new Date('2026-10-25T12:00:00.000Z');
const base = { remoteWorkEnabled: true, remoteWorkBotEnabled: true, remoteWorkBotBlockOnsiteToday: true, remoteWorkAllowAfterOnsiteCheckout: true };

describe('گیت دورکاری بعد از حضوری', () => {
  beforeEach(() => { state.settings = { ...base }; state.record = null; });

  test('بدون رکورد حضوری ⇒ مجاز', () => { assert.equal(checkStart({ id: 1 }, { now }).ok, true); });

  test('حضوری باز (بدون خروج) ⇒ مسدود ONSITE_OPEN', () => {
    state.record = { check_in_time: '2026-10-25T05:00:00.000Z', check_out_time: null, via_remote: 0 };
    const r = checkStart({ id: 1 }, { now });
    assert.equal(r.ok, false); assert.equal(r.code, 'ONSITE_OPEN');
  });

  test('حضوری با خروج ثبت‌شده ⇒ مجاز', () => {
    state.record = { check_in_time: '2026-10-25T05:00:00.000Z', check_out_time: '2026-10-25T10:00:00.000Z', via_remote: 0 };
    assert.equal(checkStart({ id: 1 }, { now }).ok, true);
  });

  test('خروج در آینده (بعد از now) ⇒ مجاز نیست', () => {
    state.record = { check_in_time: '2026-10-25T05:00:00.000Z', check_out_time: '2026-10-25T13:00:00.000Z', via_remote: 0 };
    assert.equal(checkStart({ id: 1 }, { now }).ok, false);
  });

  test('تنظیم اجازه خاموش ⇒ مثل قبل ONSITE_TODAY', () => {
    state.settings.remoteWorkAllowAfterOnsiteCheckout = false;
    state.record = { check_in_time: '2026-10-25T05:00:00.000Z', check_out_time: '2026-10-25T10:00:00.000Z', via_remote: 0 };
    const r = checkStart({ id: 1 }, { now });
    assert.equal(r.ok, false); assert.equal(r.code, 'ONSITE_TODAY');
  });

  test('مسدودسازی کلی خاموش ⇒ همیشه مجاز', () => {
    state.settings.remoteWorkBotBlockOnsiteToday = false;
    state.record = { check_in_time: '2026-10-25T05:00:00.000Z', check_out_time: null, via_remote: 0 };
    assert.equal(checkStart({ id: 1 }, { now }).ok, true);
  });
});
