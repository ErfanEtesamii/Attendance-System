// کلاینت فقط‌خواندنی دیدار: معامله‌های موفقِ یک کاریز (POST /deal/search_v2). کلید فقط در query می‌رود و هرگز لاگ نمی‌شود.
'use strict';
const config = require('../config');

async function fetchWonDeals({ fetchImpl = fetch, cfg = config.didar, pageSize = 100, maxPages = 50 } = {}) {
  if (!cfg.apiKey) { const e = new Error('کلید API دیدار تنظیم نشده است.'); e.code = 'DIDAR_NOT_CONFIGURED'; throw e; }
  const all = [];
  for (let page = 0; page < maxPages; page += 1) {
    const res = await fetchImpl(`${cfg.baseUrl}/deal/search_v2?apikey=${encodeURIComponent(cfg.apiKey)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ Criteria: { Status: 'Won', PipelineId: cfg.salesPipelineId, Sort: 9 }, From: page * pageSize, Limit: pageSize }),
    });
    if (!res.ok) { const e = new Error(`دیدار پاسخ خطا داد (HTTP ${res.status}).`); e.code = 'DIDAR_HTTP'; throw e; }
    const list = ((await res.json()).Response || {}).List || [];
    all.push(...list);
    if (list.length < pageSize) break;
  }
  return all;
}

module.exports = { fetchWonDeals };
