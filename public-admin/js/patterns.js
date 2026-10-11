// هشدار الگوها در پنل (S5-7c): رندر خالص «رشته‌ی HTML» از پاسخ GET /admin/analytics/patterns (بدون DOM، قابل‌تست در Node).
// زبان: همه‌جا «نشانه/الگو» و هرگز لحن قضاوت یا حکم؛ هر مورد دلیل و عددهایش را نشان می‌دهد و بالای فهرست هشدار ثابت هست.
// رنگ فقط با کلاس CSS (CSP پنل style درون‌خطی/on* را نمی‌پذیرد)؛ همه‌ی متن‌ها escape می‌شوند.
(function (root) {
  'use strict';
  const FALLBACK_ESC = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const RULE_CLASS = { consecutive_late: 'orange', weekday_late: 'orange', weekend_adjacent_absence: 'red', sudden_increase: 'purple', identical_times: 'blue' };
  const DISCLAIMER = 'این‌ها «نشانه/الگو»ی آماری‌اند، نه اتهام؛ پیش از هر برداشتی با خودِ فرد و شرایط کاری‌اش بررسی شود.';

  function patternsHtml(report, deps) {
    const esc = (deps && deps.esc) || FALLBACK_ESC;
    const fa = (deps && deps.fa) || ((s) => s);
    const n = (v) => fa(String(v));
    const r = report || {};
    const summary = r.summary || { usersAnalyzed: 0, usersWithFindings: 0, findings: 0 };
    const off = (r.rules || []).filter((x) => x.enabled === false).map((x) => x.title);
    const head = `<figcaption>هشدار الگوها <span class="badge blue">نشانه، نه اتهام</span></figcaption>` +
      `<p class="chart-note pattern-disclaimer">${esc(r.disclaimer || DISCLAIMER)}</p>`;
    const meta = `<p class="chart-note">${esc(n(summary.usersAnalyzed))} نفر بررسی شد؛ ${esc(n(summary.usersWithFindings))} نفر دارای ${esc(n(summary.findings))} نشانه.` +
      (off.length ? ` قاعده‌های خاموش (در تنظیمات): ${esc(off.join('، '))}.` : '') + '</p>';
    if (!(r.users || []).length) {
      return `<figure class="chart-fig pattern-fig">${head}${meta}<div class="empty">هیچ نشانه‌ای برای این ماه و دامنه پیدا نشد.</div></figure>`;
    }
    const items = r.users.map((u) => {
      const who = esc((u.user && u.user.fullName) || '—') + (u.user && u.user.department ? ` <span class="sub">${esc(u.user.department)}</span>` : '');
      const fs = (u.findings || []).map((f) => `<li class="pattern-item"><span class="badge ${RULE_CLASS[f.rule] || 'blue'}">${esc(f.title)}</span><p class="pattern-reason">${esc(f.reason)}</p></li>`).join('');
      return `<section class="pattern-user"><h4>${who}</h4><ul class="pattern-list">${fs}</ul></section>`;
    }).join('');
    return `<figure class="chart-fig pattern-fig">${head}${meta}${items}</figure>`;
  }

  const api = { patternsHtml, RULE_CLASS, DISCLAIMER };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.PatternWarnings = api;
}(typeof window !== 'undefined' ? window : undefined));
