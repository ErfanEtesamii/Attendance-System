// صفحه‌ی «پورسانت من» و کارت پورسانت «وضعیت من» (طراحی). داده از GET /admin/me/commission می‌آید؛ تا آماده‌شدن سرور، حالت «بدون داده» نشان داده می‌شود.
(function () {
  'use strict';
  const AP = window.AP;
  const { esc, fmt } = AP;

  const RULES_DISCOUNT = [['۰٪ تخفیف', '۵٪'], ['۱ تا ۷٪', '۴٪'], ['۸ تا ۱۵٪', '۳٪'], ['۱۶ تا ۲۳٪', '۲٪'], ['۲۴ تا ۳۰٪', '۱٪'], ['بیش از ۳۰٪', 'بدون پورسانت']];
  const RULES_AMOUNT = [['تا ۱۵۰ میلیون', '۱٪'], ['تا ۲۵۰ میلیون', '۲٪'], ['تا ۳۵۰ میلیون', '۳٪'], ['تا ۴۵۰ میلیون', '۴٪'], ['بالاتر از ۴۵۰ میلیون', '۵٪']];
  // مبلغ خوانا: زیر ۱ میلیارد «۹۵۰٫۲ میلیون»؛ از ۱ میلیارد به بالا «۴ میلیارد و ۷۲۷ میلیون»
  const million = (t) => {
    const v = Math.max(0, Number(t) || 0);
    if (v >= 1e9) {
      let b = Math.floor(v / 1e9); let m = Math.round((v - b * 1e9) / 1e6);
      if (m >= 1000) { b += 1; m = 0; }
      return m ? `${fmt.num(b)} میلیارد و ${fmt.num(m)} میلیون` : `${fmt.num(b)} میلیارد`;
    }
    const mm = Math.round(v / 1e5) / 10;
    return mm >= 1000 ? `${fmt.num(1)} میلیارد` : `${fmt.num(mm)} میلیون`;
  };

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
      <span class="cm-badge" aria-label="درصد پورسانت">${x.eligible ? `${fmt.num(x.ratePercent)}٪` : '۰٪'}</span>
      <div class="cm-deal-main"><b class="cm-deal-title">${esc(x.title)}</b><span class="cm-deal-sub">${esc(x.customer)} · ${esc(x.dateLabel)}</span></div>
      <div class="cm-deal-num"><em>مبلغ فاکتور</em><b>${fmt.num(x.amountToman)}</b></div>
      <div class="cm-deal-num"><em>تخفیف</em><b>${fmt.num(x.discountPercent)}٪</b></div>
      <div class="cm-deal-rate">${chips}</div>
      <div class="cm-deal-com"><em>پورسانت</em><b>${x.eligible ? fmt.num(x.commissionToman) : '—'}</b></div></li>`;
  }

  // حلقه‌ی پیشرفت تا پله‌ی بعدی مبلغ فاکتور (ویژگی SVG؛ بدون style درون‌خطی)
  function ring(pct, centerTop, centerBottom) {
    const C = 414.69; const dash = Math.round((Math.max(0, Math.min(100, pct)) / 100) * C * 10) / 10; // محیط دایره‌ی r=66
    return `<svg class="cm-ring" viewBox="0 0 180 180" role="img" aria-label="پیشرفت تا پله‌ی بعد">
      <defs><linearGradient id="cmg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" class="cm-g1"/><stop offset="1" class="cm-g2"/></linearGradient></defs>
      <circle class="cm-ring-dots" cx="90" cy="90" r="82"/>
      <circle class="cm-ring-disc" cx="90" cy="90" r="56"/>
      <circle class="cm-ring-bg" cx="90" cy="90" r="66"/>
      <circle class="cm-ring-fg" cx="90" cy="90" r="66" stroke="url(#cmg)" stroke-dasharray="${dash} ${C}" transform="rotate(-90 90 90)"/>
      <text class="cm-ring-top" x="90" y="92" text-anchor="middle">${centerTop}</text><text class="cm-ring-bot" x="90" y="112" text-anchor="middle">${centerBottom}</text></svg>`;
  }

  function commissionHtml(d, title) {
    const t = d.totals;
    const next = t.nextTier
      ? `<div class="cm-hero-ring">${ring(t.nextTier.progress || 0, `${fmt.num(Math.round(t.nextTier.progress || 0))}٪`, 'تا پله‌ی بعد')}<p class="cm-ring-cap">${million(t.nextTier.remainingToman)} دیگر تا پورسانت مبلغی <b>${fmt.num(t.nextTier.rate)}٪</b> روی یک فاکتور</p></div>`
      : `<div class="cm-hero-ring">${ring(100, '🏆', 'بالاترین پله')}<p class="cm-ring-cap">فاکتور شما در بالاترین پله‌ی مبلغی است</p></div>`;
    return `<div class="view-header"><div><h2>${esc(title || 'پورسانت من')}</h2><div class="sub">معامله‌های موفق ${esc(d.monthLabel)} در دیدار</div></div></div>
      <section class="card cm-hero"><div class="cm-hero-main"><div class="cm-hero-head"><span class="cm-hero-chip" aria-hidden="true">${AP.icon('wallet')}</span><h3>پورسانت ${esc(d.monthLabel)}</h3></div><p class="cm-hero-intro">${fmt.num(t.dealsCount)} معامله‌ی موفق در دیدار</p>
        <p class="cm-hero-amount"><span>${fmt.num(t.commissionToman)}</span><small>تومان</small></p>
        <div class="cm-hero-foot">${d.season ? `<span class="cm-season">${esc(d.season.label)}: <b>${fmt.num(d.season.commissionToman)}</b> تومان از ${fmt.num(d.season.dealsCount)} فاکتور</span>` : ''}<span class="cm-note"><span aria-hidden="true">ⓘ</span> تخمینی؛ مبلغ نهایی با تأیید حسابداری است</span></div></div>${next}</section>
      <div class="stat-grid cm-stats">
        <div class="stat"><div class="stat-icon g-green">${AP.icon('check')}</div><div class="stat-value">${fmt.num(t.dealsCount)}</div><div class="stat-label">معامله‌ی موفق</div></div>
        <div class="stat"><div class="stat-icon g-blue">${AP.icon('trend')}</div><div class="stat-value">${million(t.salesToman)}</div><div class="stat-label">جمع فروش (تومان)</div></div>
        <div class="stat"><div class="stat-icon g-orange">${AP.icon('wallet')}</div><div class="stat-value">${fmt.num(t.avgRatePercent)}٪</div><div class="stat-label">میانگین درصد پورسانت</div></div>
        <div class="stat"><div class="stat-icon g-purple">${AP.icon('info')}</div><div class="stat-value">${fmt.num(t.avgDiscountPercent)}٪</div><div class="stat-label">میانگین تخفیف</div></div></div>
      <section class="card cm-deals"><h3>معامله‌های موفق</h3>${d.deals.length ? `<ul class="cm-deal-list">${d.deals.map(dealRow).join('')}</ul>` : '<div class="empty">هنوز معامله‌ی موفقی در این ماه ثبت نشده است.</div>'}</section>
      ${rulesHtml()}`;
  }

  // کارت فشرده برای «وضعیت من» (کنار کارت کارکرد)
  // داده‌ی نمونه فقط برای مالک (ببیند کارت چه شکلی است)؛ هیچ‌جا ذخیره یا به سرور فرستاده نمی‌شود
  function sampleData() {
    const mk = (title, customer, dateLabel, amountToman, discountPercent, discountRate, amountRate) => {
      const eligible = discountPercent <= 30; const ratePercent = eligible ? discountRate + amountRate : 0;
      return { title, customer, dateLabel, amountToman, discountPercent, eligible, discountRate: eligible ? discountRate : 0, amountRate: eligible ? amountRate : 0, ratePercent, commissionToman: Math.round(amountToman * ratePercent / 100) };
    };
    const deals = [mk('معامله‌ی نمونه ۱', 'مشتری نمونه', '۱۴۰۵/۰۸/۲۰', 510000000, 0, 5, 5), mk('معامله‌ی نمونه ۲', 'مشتری نمونه', '۱۴۰۵/۰۸/۱۴', 380300000, 6, 4, 4), mk('معامله‌ی نمونه ۳', 'مشتری نمونه', '۱۴۰۵/۰۸/۰۷', 33700000, 12, 3, 1), mk('معامله‌ی نمونه ۴', 'مشتری نمونه', '۱۴۰۵/۰۸/۰۲', 26200000, 35, 0, 0)];
    const sum = (k) => deals.reduce((t, x) => t + x[k], 0);
    return { monthLabel: 'آبان ۱۴۰۵', season: { label: 'پاییز ۱۴۰۵', dealsCount: 9, commissionToman: 61250000 },
      totals: { commissionToman: sum('commissionToman'), dealsCount: deals.length, noInvoiceCount: 0, salesToman: sum('amountToman'), avgRatePercent: 6.2, avgDiscountPercent: 13.2, nextTier: { rate: 5, remainingToman: 31200000, progress: 79 } }, deals };
  }
  const demoTag = '<span class="cm-demo">نمونه</span>';

  function commissionCard(d, demo) {
    const nt = d.totals.nextTier;
    const next = nt ? `<div class="cm-card-next"><div class="hbar-track tb-bar"><div class="hbar-fill" data-progress="${Math.max(0, Math.min(100, Number(nt.progress) || 0))}"></div></div><span>${million(nt.remainingToman)} دیگر تا پله‌ی <b>${fmt.num(nt.rate)}٪</b> مبلغ</span></div>` : '';
    return `<section class="card cm-card" aria-label="پورسانت این ماه">
      <div class="cm-card-head"><span class="cm-card-chip" aria-hidden="true">${AP.icon('wallet')}</span><h3>پورسانت ${esc(d.monthLabel)}</h3>${demo ? demoTag : ''}<a class="cm-card-link" href="#/commission">جزئیات ←</a></div>
      <p class="cm-card-sub">${fmt.num(d.totals.dealsCount)} معامله‌ی موفق در دیدار</p>
      <p class="cm-card-amount"><span>${fmt.num(d.totals.commissionToman)}</span><small>تومان</small></p>
      ${next}
      <div class="cm-card-foot"><span class="cm-card-pill">میانگین ${fmt.num(d.totals.avgRatePercent)}٪</span>${d.season ? `<span class="cm-card-pill alt">${esc(d.season.label)}: ${million(d.season.commissionToman)}</span>` : ''}</div></section>`;
  }

  // ---------- وضعیت تیمی فروش: دو لیدربرد (تعداد فاکتور / مبلغ فاکتور)؛ مبلغ فقط برای ردیف خودِ شخص ----------
  const MEDAL = ['🥇', '🥈', '🥉'];
  const initial = (n) => (AP.initials ? AP.initials(n) : String(n).slice(0, 1));
  // دایره‌ی آواتار: عکس پروفایل (در صورت وجود) از سازوکار مشترک avatar.js؛ سابق‌ها (userId رشته‌ای) فقط حرف اول
  const av = (x, cls) => (Number.isInteger(x.userId) && AP.avatar ? AP.avatar(x.name, cls, x.userId) : `<span class="avatar ${cls}">${esc(initial(x.name))}</span>`);
  const formerTag = (x) => (x.isFormer ? '<i class="tb-former">سابق</i>' : '');
  const HIDDEN = '<span class="tb-val--hidden" aria-label="مبلغ برای شما نمایش داده نمی‌شود">••••</span>';
  const chip = (label, val) => `<span class="tb-chip"><i>${label}</i><b>${val}</b></span>`;

  // سکوی سه نفر اول (ترتیب بصری: ۲، ۱، ۳)
  function podium(rows, valueHtml, subHtml) {
    const top = rows.filter((x) => x.rank <= 3); if (!top.length) return '';
    const order = [2, 1, 3].map((r) => top.find((x) => x.rank === r)).filter(Boolean);
    return `<div class="tb-podium">${order.map((x) => `<div class="tb-pod tb-pod--${x.rank}${x.isMe ? ' is-me' : ''}">
      ${x.rank === 1 ? '<span class="tb-crown" aria-hidden="true">👑</span>' : ''}<span class="tb-pod-avwrap">${av(x, 'tb-pod-av')}<i class="tb-pod-medal" aria-hidden="true">${MEDAL[x.rank - 1]}</i></span>
      <b class="tb-pod-name">${esc(x.name)}${formerTag(x)}${x.isMe ? '<i class="tb-me">شما</i>' : ''}</b><span class="tb-pod-sub">${subHtml(x)}</span>
      <div class="tb-pod-step"><span class="tb-pod-val">${valueHtml(x)}</span><span class="tb-pod-no">${fmt.num(x.rank)}</span></div></div>`).join('')}</div>`;
  }

  // فهرست جزئیاتِ همه‌ی رتبه‌ها (ردیف: رتبه | نام + چیپ‌های جزئیات | مقدار اصلی + نوار)
  function detailRow(x, mainHtml, barPct, chips) {
    return `<li class="tb-row${x.isMe ? ' is-me' : ''}"><span class="tb-rank${x.rank <= 3 ? ` tb-rank--${x.rank}` : ''}">${x.rank <= 3 ? MEDAL[x.rank - 1] : fmt.num(x.rank)}</span>
      <div class="tb-row-main"><span class="tb-name">${esc(x.name)}${formerTag(x)}${x.isMe ? '<i class="tb-me">شما</i>' : ''}</span><div class="tb-chips">${chips}</div></div>
      <div class="tb-row-val">${mainHtml}${barPct != null ? `<div class="hbar-track tb-bar"><div class="hbar-fill" data-progress="${barPct}"></div></div>` : ''}</div></li>`;
  }

  function countView(p) {
    const max = Math.max(1, ...p.byCount.map((x) => x.count));
    const rows = p.byCount.map((x) => detailRow(x, `<span class="tb-val"><b>${fmt.num(x.count)}</b> فاکتور</span>`, Math.max(4, Math.round((x.count / max) * 100)),
      chip('سهم از کل', `${fmt.num(x.sharePercent)}٪`) + (x.noInvoiceCount ? chip('معامله‌ی بدون فاکتور', fmt.num(x.noInvoiceCount)) : '') + (x.gapToPrev != null ? chip('فاصله تا نفر بالاتر', `${fmt.num(x.gapToPrev)} فاکتور`) : chip('', '👑 پیشتاز')))).join('');
    return `${podium(p.byCount, (x) => `${fmt.num(x.count)}`, (x) => `فاکتور · سهم ${fmt.num(x.sharePercent)}٪`)}
      <section class="card tb-card"><h3>🏆 جدول تعداد فاکتور فروش</h3><ol class="tb-list">${rows}</ol></section>`;
  }
  function amountView(p) {
    const vis = p.byAmount.filter((x) => x.amountToman != null);
    const max = Math.max(1, ...vis.map((x) => x.amountToman));
    const hidesOthers = p.byAmount.some((x) => x.amountToman == null);
    const rows = p.byAmount.map((x) => (x.amountToman == null
      ? detailRow(x, `<span class="tb-val">${HIDDEN}</span>`, null, chip('تعداد', `${fmt.num(x.count)} فاکتور`))
      : detailRow(x, `<span class="tb-val"><b>${million(x.amountToman)}</b> تومان</span>`, Math.max(4, Math.round((x.amountToman / max) * 100)),
        chip('تعداد', `${fmt.num(x.count)} فاکتور`) + chip('میانگین فاکتور', million(x.avgInvoiceToman)) + chip('بزرگ‌ترین فاکتور', million(x.maxInvoiceToman)) + chip('میانگین تخفیف', `${fmt.num(x.avgDiscountPercent)}٪`) + chip('پورسانت', `${fmt.num(x.commissionToman)}`)))).join('');
    return `${podium(p.byAmount, (x) => (x.amountToman != null ? million(x.amountToman) : HIDDEN), (x) => (x.amountToman != null ? `تومان · ${fmt.num(x.count)} فاکتور` : `${fmt.num(x.count)} فاکتور`))}
      <section class="card tb-card"><h3>💎 جدول مبلغ فاکتور فروش</h3><ol class="tb-list">${rows}</ol>${hidesOthers ? '<p class="tb-note"><span aria-hidden="true">🔒</span> فقط رتبه‌ی همکاران دیده می‌شود؛ مبلغ شما مخصوص خودتان است.</p>' : ''}</section>`;
  }

  // نوار خلاصه‌ی بازه (تعداد فاکتور برای همه؛ مبلغ و پورسانت کل فقط ادمین/مالک)
  function summaryStrip(sm) {
    if (!sm) return '';
    const tiles = [['g-blue', 'trend', fmt.num(sm.count), 'فاکتور فروش تیم'], ['g-green', 'employees', `${fmt.num(sm.activeMembers)} از ${fmt.num(sm.members)}`, 'فروشنده‌ی فعال']];
    if (sm.amountToman != null) tiles.push(['g-purple', 'wallet', million(sm.amountToman), 'جمع فروش (تومان)'], ['g-orange', 'wallet', million(sm.commissionToman), 'جمع پورسانت (تومان)']);
    return `<div class="stat-grid tb-summary">${tiles.map(([g, ic, v, l]) => `<div class="stat"><div class="stat-icon ${g}">${AP.icon(ic)}</div><div class="stat-value">${v}</div><div class="stat-label">${l}</div></div>`).join('')}</div>`;
  }

  function boardPanel(id, p, active) {
    return `<div class="tb-panel${active ? ' is-active' : ''}" data-tb-panel="${id}"><div class="tb-period">${esc(p.label)}</div>${summaryStrip(p.summary)}
      <div class="tb-tabs tb-tabs--metric" role="tablist" aria-label="نوع رتبه‌بندی"><button type="button" class="tb-tab is-active" role="tab" aria-selected="true" data-tb-metric="count">🏆 تعداد فاکتور</button><button type="button" class="tb-tab" role="tab" aria-selected="false" data-tb-metric="amount">💎 مبلغ فاکتور</button></div>
      <div class="tb-metric is-active" data-tb-metric-panel="count">${countView(p)}</div>
      <div class="tb-metric" data-tb-metric-panel="amount">${amountView(p)}</div></div>`;
  }
  function teamBoardHtml(d) {
    const tabs = [['month', 'ماهانه', d.month], ['season', 'فصلی', d.season], ['all', 'کل زمان', d.all]].filter((t) => t[2]);
    return `<div class="view-header"><div><h2>وضعیت تیمی فروش</h2><div class="sub">رتبه‌ی تیم فروش · مبلغ فاکتور هر نفر فقط برای خودش (و سرپرست/مدیریت) نمایش داده می‌شود</div></div></div>
      <div class="tb-tabs" role="tablist">${tabs.map(([id, label], k) => `<button type="button" class="tb-tab${k === 0 ? ' is-active' : ''}" role="tab" aria-selected="${k === 0}" data-tb-tab="${id}">${label}</button>`).join('')}</div>
      ${tabs.map(([id, , p], k) => boardPanel(id, p, k === 0)).join('')}`;
  }
  // کارت پورسانت اعضا (ادمین/مالک/سرپرست)؛ هر کارت به جزئیات همان همکار می‌رود
  function membersHtml(m) {
    if (!m || !m.members || !m.members.length) return '';
    return `<section class="tb-members"><h3 class="tb-members-title">کارت پورسانت اعضا <span>${esc(m.monthLabel)}</span></h3>
      <div class="tb-members-grid">${m.members.map((x) => `<a class="card tb-member${x.isFormer ? ' is-former' : ''}" href="#/salesmember/${encodeURIComponent(x.userId)}">${av(x, 'tb-pod-av')}
        <div class="tb-member-main"><b>${esc(x.name)}${formerTag(x)}</b><span>${fmt.num(x.dealsCount || 0)} معامله · ${million(x.salesToman)} فروش</span></div>
        <div class="tb-member-com"><em>پورسانت ماه</em><b>${fmt.num(x.commissionToman || 0)}</b></div></a>`).join('')}</div></section>`;
  }
  function mountBoard(page) {
    page.addEventListener('click', (e) => {
      const m = e.target.closest('[data-tb-metric]');
      if (m) {
        const panel = m.closest('.tb-panel');
        panel.querySelectorAll('[data-tb-metric]').forEach((b) => { const on = b === m; b.classList.toggle('is-active', on); b.setAttribute('aria-selected', String(on)); });
        panel.querySelectorAll('[data-tb-metric-panel]').forEach((p) => p.classList.toggle('is-active', p.dataset.tbMetricPanel === m.dataset.tbMetric));
        return;
      }
      const t = e.target.closest('[data-tb-tab]'); if (!t) return;
      page.querySelectorAll('[data-tb-tab]').forEach((b) => { const on = b === t; b.classList.toggle('is-active', on); b.setAttribute('aria-selected', String(on)); });
      page.querySelectorAll('[data-tb-panel]').forEach((p) => p.classList.toggle('is-active', p.dataset.tbPanel === t.dataset.tbTab));
    });
  }

  // بعد از ورود: اگر کاربر به دیدار نگاشت شده، دو آیتم «پورسانت من» و «وضعیت تیمی فروش» به منو اضافه می‌شود (خطا ⇒ بی‌صدا، منو دست‌نخورده)
  AP.probeSales = async function probeSales() {
    try {
      const r = await AP.api('/admin/me/commission');
      if (!r) return;
      AP.state.sales = !!r.commission; AP.state.salesTeam = !!r.canViewTeam; AP.state.salesDemo = !r.commission && AP.isOwnerMe();
      if (!AP.state.sales && !AP.state.salesTeam && !AP.state.salesDemo) return;
      AP.rebuildNav();
      const key = (String(location.hash).match(/^#\/([^/?]+)/) || [])[1] || 'dashboard';
      if (AP.setActiveNav) AP.setActiveNav(key);
    } catch (_) { /* غیرحیاتی */ }
  };
  AP.commissionUi = { sampleData, membersHtml, commissionHtml, commissionCard, teamBoardHtml };
  // ---------- نوار بازه‌ی زمانی (این ماه / ماه قبل / این فصل / کل زمان / بازه‌ی دلخواه) ----------
  const J = window.Jalali;
  const defaultRange = () => {
    if (AP.state.salesRange) return AP.state.salesRange;
    const to = fmt.today(); const j = J.isoToJalali(to);
    return { from: J.jalaliToIso(j.jy, j.jm, 1), to };
  };
  // «کل زمان» و بازه‌ی دلخواهِ آزاد فقط برای ادمین/مالک/سرپرست؛ بقیه فقط چیپ‌های ماه/ماه قبل/فصل (سرور هم کف می‌گذارد)
  const rangeShell = (priv, presets) => {
    const r = defaultRange();
    return `<div class="cm-range" data-sales-range>${AP.rangeBar.html({ from: r.from, to: r.to, label: 'بازه‌ی زمانی', presets: presets && !priv ? presets : (priv ? ['month', 'lastMonth', 'season', 'all'] : ['month', 'lastMonth', 'season']), fields: priv })}</div>`;
  };
  // mount مشترک: با هر تغییر بازه، body را از load(from, to) دوباره می‌سازد
  function mountRange(page, load) {
    const root = page.querySelector('[data-sales-range]'); const body = page.querySelector('[data-sales-body]');
    if (!root || !body) return;
    if (AP.dates && AP.dates.mount) AP.dates.mount(root);
    let seq = 0;
    AP.rangeBar.bind(root, {
      onApply: async (from, to) => {
        AP.state.salesRange = { from, to }; const me = (seq += 1);
        const ex = page.querySelector('[data-sales-export]'); if (ex) ex.innerHTML = exportBtn(from, to);
        body.setAttribute('aria-busy', 'true');
        const html = await load(from, to).catch(() => '<div class="card"><div class="empty">بارگذاری انجام نشد؛ دوباره تلاش کنید.</div></div>');
        if (me !== seq) return;
        body.innerHTML = html; body.removeAttribute('aria-busy');
        body.querySelectorAll('[data-progress]').forEach((el) => el.style.setProperty('--progress', `${Math.max(0, Math.min(100, Number(el.dataset.progress) || 0))}%`));
      },
    });
  }
  const exportBtn = (from, to) => AP.exportBar({ path: '/api/admin/sales-team/export', params: { from, to }, formats: [['xlsx', 'اکسل برای حسابداری']], print: false });
  const qs = (from, to) => `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
  const EMPTY_TEAM = '<div class="card"><div class="empty">در این بازه فاکتور فروشی ثبت نشده است.</div></div>';
  const clampNote = (lb) => (lb && lb.range && lb.range.clamped ? `<p class="tb-note cm-clamp">برای شما بازه از ${esc(fmt.dateLong ? fmt.dateLong(lb.range.from) : lb.range.from)} محدود شد.</p>` : '');
  async function teamBody(from, to) {
    const [data, members] = await Promise.all([AP.api(`/admin/sales-team/leaderboard?${qs(from, to)}`).then((r) => r && r.leaderboard).catch(() => null), AP.api(`/admin/sales-team/members?${qs(from, to)}`).catch(() => null)]);
    const mem = membersHtml(members);
    if (!data || !data.range || !data.byCount || !data.byCount.some((x) => x.count > 0)) return EMPTY_TEAM + mem;
    return `${clampNote(data)}${boardPanel('range', data, true)}${mem}`;
  }

  AP.view('commission', {
    skeleton: 'plan',
    perm: 'me.read',
    async render() {
      const r0 = defaultRange();
      let data = await AP.api(`/admin/me/commission?${qs(r0.from, r0.to)}`).then((r) => r && r.commission).catch(() => null);
      const demo = !data && AP.isOwnerMe(); if (demo) data = sampleData();
      if (!data) return { html: '<div class="view-header"><div><h2>پورسانت من</h2></div></div><div class="card"><div class="empty">پورسانت فقط برای تیم فروش است (یا ایمیل دیدار شما هنوز ثبت نشده).</div></div>', mount() {} };
      if (demo) return { html: `<div class="cm-demo-banner">${demoTag} این صفحه فقط یک نمونه برای دیدن ظاهر است؛ داده‌ی واقعی نیست.</div>${commissionHtml(data)}`, mount() {} };
      return {
        html: `${rangeShell(['admin', 'owner'].includes(AP.state.me.role) || !!AP.state.salesTeam, ['month', 'lastMonth', 'season'])}<div data-sales-body>${commissionHtml(data)}</div>`,
        mount(page) { mountRange(page, async (from, to) => { const c = await AP.api(`/admin/me/commission?${qs(from, to)}`).then((r) => r && r.commission); return c ? commissionHtml(c) : EMPTY_TEAM; }); },
      };
    },
  });
  AP.view('salesteam', {
    skeleton: 'plan',
    perm: 'me.read',
    async render() {
      if (!AP.state.sales && !AP.state.salesTeam && !AP.isOwnerMe()) return { html: '<div class="view-header"><div><h2>وضعیت تیمی فروش</h2></div></div><div class="card"><div class="empty">این بخش مخصوص تیم فروش است.</div></div>', mount() {} };
      const r0 = defaultRange();
      const body = await teamBody(r0.from, r0.to);
      return {
        html: `<div class="view-header"><div><h2>وضعیت تیمی فروش</h2><div class="sub">رتبه‌ی تیم فروش · مبلغ فاکتور هر نفر فقط برای خودش (و سرپرست/مدیریت) نمایش داده می‌شود</div></div>${AP.state.salesTeam ? `<div class="header-actions" data-sales-export>${exportBtn(r0.from, r0.to)}</div>` : ''}</div>${rangeShell(!!AP.state.salesTeam)}<div data-sales-body>${body || '<div class="card"><div class="empty">در این بازه فاکتور فروشی ثبت نشده است.</div></div>'}</div>`,
        mount(page) { mountBoard(page); mountRange(page, teamBody); },
      };
    },
  });
  // کارت پورسانتِ یک همکار برای ادمین/مالک/سرپرست (دسترسی در سرور)
  AP.view('salesmember', {
    skeleton: 'plan',
    perm: 'me.read',
    navId: 'salesteam',
    async render(param) {
      let pid = String(param); try { pid = decodeURIComponent(pid); } catch (_) { /* همان مقدار */ }
      const r0 = defaultRange(); const url = (f, t) => `/admin/sales-team/members/${encodeURIComponent(pid)}?${qs(f, t)}`;
      const r = await AP.api(url(r0.from, r0.to)).catch(() => null);
      const back = '<a class="tb-back" href="#/salesteam">← وضعیت تیمی فروش</a>';
      if (!r || !r.commission) return { html: `${back}<div class="card"><div class="empty">این همکار پیدا نشد یا اجازه‌ی دیدنش را ندارید.</div></div>`, mount() {} };
      const title = `پورسانت ${r.name}${r.isFormer ? ' (سابق)' : ''}`;
      return {
        html: `${back}${rangeShell(true)}<div data-sales-body>${commissionHtml(r.commission, title)}</div>`,
        mount(page) { mountRange(page, async (from, to) => { const x = await AP.api(url(from, to)); return x && x.commission ? commissionHtml(x.commission, title) : EMPTY_TEAM; }); },
      };
    },
  });
})();
