// صفحه‌ی «پورسانت من» و کارت پورسانت «وضعیت من» (طراحی). داده از GET /admin/me/commission می‌آید؛ تا آماده‌شدن سرور، حالت «بدون داده» نشان داده می‌شود.
(function () {
  'use strict';
  const AP = window.AP;
  const { esc, fmt } = AP;

  const RULES_DISCOUNT = [['۰٪ تخفیف', '۵٪'], ['۱ تا ۷٪', '۴٪'], ['۸ تا ۱۵٪', '۳٪'], ['۱۶ تا ۲۳٪', '۲٪'], ['۲۴ تا ۳۰٪', '۱٪'], ['بیش از ۳۰٪', 'بدون پورسانت']];
  const RULES_AMOUNT = [['تا ۱۵۰ میلیون', '۱٪'], ['تا ۲۵۰ میلیون', '۲٪'], ['تا ۳۵۰ میلیون', '۳٪'], ['تا ۴۵۰ میلیون', '۴٪'], ['بالاتر از ۴۵۰ میلیون', '۵٪']];
  const million = (t) => `${fmt.num(Math.round(Number(t || 0) / 1e5) / 10)} میلیون`;

  function rulesHtml() {
    const table = (title, rows) => `<div class="cm-rule"><h4>${title}</h4>${rows.map(([a, b]) => `<div class="cm-rule-row"><span>${a}</span><b>${b}</b></div>`).join('')}</div>`;
    return `<details class="card cm-rules"><summary>آیین‌نامه‌ی پورسانت<span class="cm-rules-hint">درصد نهایی = جمع دو جدول</span></summary>
      <div class="cm-rule-grid">${table('بر اساس درصد تخفیف', RULES_DISCOUNT)}${table('بر اساس مبلغ فاکتور', RULES_AMOUNT)}</div>
      <p class="cm-rules-note">تخفیف بیش از ۳۰٪ پورسانت عادی ندارد؛ پاداش ویژه فقط با تأیید مدیریت پرداخت می‌شود.</p></details>`;
  }

  function dealRow(x) {
    const chips = x.eligible
      ? `<span class="cm-chip" title="سهم تخفیف">تخفیف ${fmt.num(x.discountRate)}٪</span><span class="cm-chip" title="سهم مبلغ فاکتور">مبلغ ${fmt.num(x.amountRate)}٪</span>`
      : '<span class="cm-chip cm-chip--off">تخفیف بیش از ۳۰٪</span>';
    return `<li class="cm-deal${x.eligible ? '' : ' is-off'}">
      <div class="cm-deal-main"><b class="cm-deal-title">${esc(x.title)}</b><span class="cm-deal-sub">${esc(x.customer)} · ${esc(x.dateLabel)}</span></div>
      <div class="cm-deal-num"><em>مبلغ فاکتور</em><b>${fmt.num(x.amountToman)}</b></div>
      <div class="cm-deal-num"><em>تخفیف</em><b>${fmt.num(x.discountPercent)}٪</b></div>
      <div class="cm-deal-rate">${chips}</div>
      <div class="cm-deal-com"><em>پورسانت</em><b>${x.eligible ? fmt.num(x.commissionToman) : '—'}</b></div></li>`;
  }

  function commissionHtml(d) {
    const t = d.totals;
    const next = t.nextTier ? `<div class="cm-next"><div class="cm-next-top"><span>تا پله‌ی بعد (${fmt.num(t.nextTier.rate)}٪ مبلغی) برای یک فاکتور</span><b>${million(t.nextTier.remainingToman)}</b></div><div class="hbar-track"><div class="hbar-fill" data-progress="${Math.max(4, Math.round(t.nextTier.progress || 0))}"></div></div></div>` : '';
    return `<div class="view-header"><div><h2>پورسانت من</h2><div class="sub">معامله‌های موفق ${esc(d.monthLabel)} در دیدار</div></div></div>
      <section class="card cm-hero"><div class="cm-hero-main"><span class="cm-hero-label">پورسانت این ماه</span>
        <p class="cm-hero-amount"><span>${fmt.num(t.commissionToman)}</span><small>تومان</small></p>
        ${d.season ? `<span class="cm-season">${esc(d.season.label)}: <b>${fmt.num(d.season.commissionToman)}</b> تومان از ${fmt.num(d.season.dealsCount)} فاکتور</span>` : ''}<span class="cm-note"><span aria-hidden="true">ⓘ</span> تخمینی؛ مبلغ نهایی با تأیید حسابداری است</span></div>${next}</section>
      <div class="stat-grid cm-stats">
        <div class="stat"><div class="stat-icon g-green">${AP.icon('check')}</div><div class="stat-value">${fmt.num(t.dealsCount)}</div><div class="stat-label">معامله‌ی موفق</div></div>
        <div class="stat"><div class="stat-icon g-blue">${AP.icon('trend')}</div><div class="stat-value">${million(t.salesToman)}</div><div class="stat-label">جمع فروش (تومان)</div></div>
        <div class="stat"><div class="stat-icon g-orange">${AP.icon('wallet')}</div><div class="stat-value">${fmt.num(t.avgRatePercent)}٪</div><div class="stat-label">میانگین درصد پورسانت</div></div>
        <div class="stat"><div class="stat-icon g-purple">${AP.icon('info')}</div><div class="stat-value">${fmt.num(t.avgDiscountPercent)}٪</div><div class="stat-label">میانگین تخفیف</div></div></div>
      <section class="card cm-deals"><h3>معامله‌های موفق</h3>${d.deals.length ? `<ul class="cm-deal-list">${d.deals.map(dealRow).join('')}</ul>` : '<div class="empty">هنوز معامله‌ی موفقی در این ماه ثبت نشده است.</div>'}</section>
      ${rulesHtml()}`;
  }

  // کارت فشرده برای «وضعیت من» (کنار کارت کارکرد)
  function commissionCard(d) {
    return `<section class="card earn-card cm-card" aria-label="پورسانت این ماه"><div class="earn-head"><h3>🏆 پورسانت این ماه</h3></div>
      <p class="earn-intro">${fmt.num(d.totals.dealsCount)} معامله‌ی موفق در ${esc(d.monthLabel)}</p>
      <p class="earn-amount"><span>${fmt.num(d.totals.commissionToman)}</span><small>تومان</small></p>
      <div class="earn-foot"><span class="earn-chip">میانگین ${fmt.num(d.totals.avgRatePercent)}٪</span>${d.season ? `<span class="earn-chip">${esc(d.season.label)}: ${fmt.num(d.season.commissionToman)}</span>` : ''}<a class="cm-card-link" href="#/commission">جزئیات ←</a></div></section>`;
  }


  // ---------- وضعیت تیمی فروش: دو لیدربرد (تعداد فاکتور / مبلغ فاکتور)؛ مبلغ فقط برای ردیف خودِ شخص ----------
  const MEDAL = ['🥇', '🥈', '🥉'];
  function boardRow(x, valueHtml) {
    return `<li class="tb-row${x.isMe ? ' is-me' : ''}"><span class="tb-rank${x.rank <= 3 ? ` tb-rank--${x.rank}` : ''}">${x.rank <= 3 ? MEDAL[x.rank - 1] : fmt.num(x.rank)}</span>
      <span class="tb-name">${esc(x.name)}${x.isMe ? '<i class="tb-me">شما</i>' : ''}</span>${valueHtml}</li>`;
  }
  function boardPanel(id, p, active) {
    const maxCount = Math.max(1, ...p.byCount.map((x) => x.count));
    const count = p.byCount.map((x) => boardRow(x, `<span class="tb-val"><b>${fmt.num(x.count)}</b> فاکتور</span><div class="hbar-track tb-bar"><div class="hbar-fill" data-progress="${Math.max(4, Math.round((x.count / maxCount) * 100))}"></div></div>`)).join('');
    const amount = p.byAmount.map((x) => boardRow(x, x.amountToman != null ? `<span class="tb-val"><b>${million(x.amountToman)}</b> تومان</span>` : '<span class="tb-val tb-val--hidden" aria-label="مبلغ برای شما نمایش داده نمی‌شود">••••</span>')).join('');
    const hidesOthers = p.byAmount.some((x) => !x.isMe && x.amountToman == null);
    return `<div class="tb-panel${active ? ' is-active' : ''}" data-tb-panel="${id}"><div class="tb-period">${esc(p.label)}</div>
      <div class="grid-2 tb-grid"><section class="card tb-card"><h3>🏆 بیشترین تعداد فاکتور فروش</h3><ol class="tb-list">${count}</ol></section>
        <section class="card tb-card"><h3>💎 بیشترین مبلغ فاکتور فروش</h3><ol class="tb-list">${amount}</ol>${hidesOthers ? '<p class="tb-note"><span aria-hidden="true">🔒</span> فقط رتبه‌ی همکاران دیده می‌شود؛ مبلغ شما مخصوص خودتان است.</p>' : ''}</section></div></div>`;
  }
  function teamBoardHtml(d) {
    const tabs = [['month', 'ماهانه', d.month], ['season', 'فصلی', d.season], ['all', 'کل زمان', d.all]].filter((t) => t[2]);
    return `<div class="view-header"><div><h2>وضعیت تیمی فروش</h2><div class="sub">رتبه‌ی تیم فروش · مبلغ فاکتور هر نفر فقط برای خودش (و سرپرست/مدیریت) نمایش داده می‌شود</div></div></div>
      <div class="tb-tabs" role="tablist">${tabs.map(([id, label], k) => `<button type="button" class="tb-tab${k === 0 ? ' is-active' : ''}" role="tab" aria-selected="${k === 0}" data-tb-tab="${id}">${label}</button>`).join('')}</div>
      ${tabs.map(([id, , p], k) => boardPanel(id, p, k === 0)).join('')}`;
  }
  function mountBoard(page) {
    page.addEventListener('click', (e) => {
      const t = e.target.closest('[data-tb-tab]'); if (!t) return;
      page.querySelectorAll('[data-tb-tab]').forEach((b) => { const on = b === t; b.classList.toggle('is-active', on); b.setAttribute('aria-selected', String(on)); });
      page.querySelectorAll('[data-tb-panel]').forEach((p) => p.classList.toggle('is-active', p.dataset.tbPanel === t.dataset.tbTab));
    });
  }

  // بعد از ورود: اگر کاربر به دیدار نگاشت شده، دو آیتم «پورسانت من» و «وضعیت تیمی فروش» به منو اضافه می‌شود (خطا ⇒ بی‌صدا، منو دست‌نخورده)
  AP.probeSales = async function probeSales() {
    try {
      const r = await AP.api('/admin/me/commission');
      if (!r || !r.commission) return;
      AP.state.sales = true; AP.rebuildNav();
      const key = (String(location.hash).match(/^#\/([^/?]+)/) || [])[1] || 'dashboard';
      if (AP.setActiveNav) AP.setActiveNav(key);
    } catch (_) { /* غیرحیاتی */ }
  };
  AP.commissionUi = { commissionHtml, commissionCard, teamBoardHtml };
  AP.view('commission', {
    skeleton: 'plan',
    perm: 'me.read',
    async render() {
      const data = await AP.api('/admin/me/commission').then((r) => r && r.commission).catch(() => null);
      return { html: data ? commissionHtml(data) : '<div class="view-header"><div><h2>پورسانت من</h2></div></div><div class="card"><div class="empty">اطلاعات پورسانت هنوز در دسترس نیست.</div></div>', mount() {} };
    },
  });
  AP.view('salesteam', {
    skeleton: 'plan',
    perm: 'me.read',
    async render() {
      const data = await AP.api('/admin/sales-team/leaderboard').then((r) => r && r.leaderboard).catch(() => null);
      return { html: data && data.month && data.month.byCount.length ? teamBoardHtml(data) : '<div class="view-header"><div><h2>وضعیت تیمی فروش</h2></div></div><div class="card"><div class="empty">هنوز فاکتور فروشی در این ماه ثبت نشده است.</div></div>', mount: mountBoard };
    },
  });
})();
