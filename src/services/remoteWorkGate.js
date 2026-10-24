// گیت شروع دورکاری از بات. این گیت فقط برای «شروع» است؛ پایان و استراحتِ نشست باز نباید با تغییر تنظیمات گیر کنند.
const settingsRepository = require('../repositories/settingsRepository');
const leaveRepository = require('../repositories/leaveRepository');
const attendanceRepository = require('../repositories/attendanceRepository');
const pendingMissionService = require('./pendingMissionService');
const { todayDateString } = require('../utils/serverTime');

const fail = (code, error) => ({ ok: false, code, error });

function checkStart(user, { now = new Date() } = {}) {
  const settings = settingsRepository.getAll();
  if (!settings.remoteWorkEnabled) return fail('REMOTE_DISABLED', 'ثبت دورکاری فعلاً برای شرکت غیرفعال است.');
  if (!settings.remoteWorkBotEnabled) return fail('REMOTE_BOT_DISABLED', 'ثبت دورکاری از طریق بات فعلاً غیرفعال است.');
  const date = todayDateString(now);
  if (leaveRepository.hasApprovedMissionOnDate(user.id, date) || pendingMissionService.pendingMissionPass(user.id, date)) {
    return fail('MISSION_TODAY', 'امروز ماموریت دارید؛ ورود و خروج را از «🕒 ثبت تردد» انجام دهید.');
  }
  if (settings.remoteWorkBotBlockOnsiteToday) {
    const record = attendanceRepository.findTodayRecord(user.id);
    if (record && record.check_in_time && Number(record.via_remote) === 0) {
      return fail('ONSITE_TODAY', 'امروز حضور حضوری ثبت کرده‌اید؛ دورکاری در همان روز ممکن نیست.');
    }
  }
  return { ok: true };
}

module.exports = { checkStart };
