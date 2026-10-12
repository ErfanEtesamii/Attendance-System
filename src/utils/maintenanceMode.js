// حالت نگهداری سراسری (فقط در حافظه‌ی پروسه). هنگام ریست برنامه روشن می‌شود تا ثبت تردد وسط پاک‌سازی نیامده.
// پروسه‌ی تک‌نمونه است (NSSM)؛ ری‌استارت = خاموش شدن خودکار.

let active = null; // { reason, since }

function enter(reason = 'maintenance') {
  active = { reason, since: new Date().toISOString() };
}
function leave() { active = null; }
function isActive() { return active !== null; }
function info() { return active ? { ...active } : null; }

module.exports = { enter, leave, isActive, info };
