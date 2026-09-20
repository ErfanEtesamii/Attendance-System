// ماژول مرکزی خواندن تنظیمات از فایل .env
// در فازهای بعد (مثلاً فاز ۲) از همین فایل برای خواندن ALLOWED_NETWORK_CIDR استفاده می‌شود.

require('dotenv').config();
const path = require('path');

const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  dbPath: path.resolve(process.cwd(), process.env.DB_PATH || './data/attendance.db'),
  nodeEnv: process.env.NODE_ENV || 'development',
  allowedNetworkCidr: process.env.ALLOWED_NETWORK_CIDR || '192.168.10.0/24',

  // آیا یک ریورس‌پراکسی (IIS/nginx/...) جلوی این سرویس روی همان سرور محلی قرار دارد؟
  // این مقدار مستقیماً روی درستی چک IP فاز ۲ اثر می‌گذارد - توضیح کامل در README.
  trustProxy: process.env.TRUST_PROXY === 'true',
};

module.exports = config;
