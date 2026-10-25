// میان‌افزار مرکزی خطا. جزئیات فنی خطا فقط در لاگ سرور چاپ می‌شود
// و پیام ساده به کلاینت برمی‌گردد تا اطلاعات داخلی سیستم افشا نشود.

function notFoundHandler(req, res) {
  res.status(404).json({ error: 'مسیر مورد نظر یافت نشد.' });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  require('../utils/logger').error('server_error', { requestId: req.id, error: err && err.message });
  res.status(err.statusCode || 500).json({
    error: err.publicMessage || 'خطای داخلی سرور رخ داده است.',
  });
}

module.exports = { notFoundHandler, errorHandler };
