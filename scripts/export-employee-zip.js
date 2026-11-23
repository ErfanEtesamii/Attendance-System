// خروجی دستی زیپ اکسل کارمندان یک ماه شمسی:  node scripts/export-employee-zip.js 1405 8 [out.zip]
const fs = require('fs');
const { closeDb } = require('../src/db/connection');
const { buildEmployeesZip } = require('../src/services/employeeMonthlyExcelService');

(async () => {
  const [y, m, out] = process.argv.slice(2);
  const year = Number(y); const month = Number(m);
  if (!Number.isInteger(year) || !Number.isInteger(month)) { console.error('استفاده: node scripts/export-employee-zip.js <سال شمسی> <ماه> [فایل خروجی]'); process.exitCode = 2; return; }
  const f = await buildEmployeesZip({ year, month });
  const path = out || f.filename;
  fs.writeFileSync(path, f.buffer);
  console.log(`${f.count} کارمند → ${path}`);
})().catch((e) => { console.error(e.message); process.exitCode = 1; }).finally(() => closeDb());
