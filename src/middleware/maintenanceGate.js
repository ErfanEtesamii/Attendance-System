// وقتی حالت نگهداری روشن است ثبت تردد را با 503 {code:'maintenance'} رد می‌کند (ریست برنامه، B2).
const maintenanceMode = require('../utils/maintenanceMode');

function maintenanceGate(req, res, next) {
  if (!maintenanceMode.isActive()) return next();
  res.set('Retry-After', '60');
  return res.status(503).json({
    error: 'سیستم در حال نگهداری است؛ چند دقیقه‌ی دیگر دوباره تلاش کنید.',
    code: 'maintenance',
  });
}

module.exports = { maintenanceGate };
