// صفحه‌ی «گزارش‌های تیم» (D10): برنامه‌ی هفتگی · گزارش روزانه · معطل‌مانده‌ها · بررسی‌نشده‌ها.
// اسکوپ نقش را سرور اعمال می‌کند (کارمند خودش، سرپرست تیم، hr/admin همه؛ hr فقط‌خواندنی)؛ دکمه‌های «مشاهده شد»/کامنت فقط با مجوز reviews.write دیده می‌شوند.
(function () {
  'use strict';
  const AP = window.AP;
  const { $, $$, esc, fmt } = AP;

  const TABS = [['daily', 'گزارش روزانه'], ['plan', 'برنامه‌ی هفتگی'], ['stuck', 'معطل‌مانده‌ها'], ['unreviewed', 'بررسی‌نشده‌ها']];
  const REASONS = { no_time: 'وقت نشد', needs_more_time: 'زمان بیشتری لازم دارد', blocked_by_others: 'منتظر دیگران', priority_changed: 'اولویت عوض شد', technical_issue: 'مشکل فنی', other: 'سایر' };
  const STATUS = { reviewed: ['approved', 'مشاهده شد'], unreviewed: ['pending', 'مشاهده‌نشده'], no_report: ['rejected', 'بدون وضعیت'], off: ['normal', 'تعطیل/مرخصی'] };
  const TASK_STATUS = { done: 'انجام شد', partial: 'ناقص', not_done: 'انجام نشد' };
  const PLAN_STATUS = { submitted: ['approved', 'ثبت‌شده'], draft: ['pending', 'پیش‌نویس'], none: ['rejected', 'ثبت نشده'] };

  const ui = { tab: 'daily', date: '', weekStart: '', userId: '', empty: (m) => esc(m) };

  const pct = (s) => (s && s.percent != null ? `${fmt.num(s.percent)}٪` : '—');

  function dailyRows(r, canWrite) {
    if (!r.members.length) return '<tr><td colspan="6" class="muted">موردی برای نمایش نیست.</td></tr>';
    return r.members.map((m) => {
      const [cls, label] = STATUS[m.status] || ['normal', m.status];
      const s = m.summary;
      const notDone = (m.notDone || []).map((t) => `<li>${esc(t.title)} — <span class="muted">${esc(TASK_STATUS[t.status] || t.status)}${t.reasonCode ? ` · ${esc(REASONS[t.reasonCode] || t.reasonCode)}` : ''}${t.reasonText ? `: ${esc(t.reasonText)}` : ''}</span></li>`).join('');
      const extras = (m.extras || []).length ? `<div class="muted">➕ خارج از برنامه: ${m.extras.map(esc).join('، ')}</div>` : '';
      const seenBtn = canWrite && m.hasReport
        ? `<button type="button" class="btn ghost small" data-act="seen" data-uid="${m.userId}">${m.status === 'reviewed' ? 'ویرایش کامنت' : 'مشاهده شد'}</button>`
        : '';
      const act = `${seenBtn} ${urgentBtn(m.userId, m.fullName)}`.trim();
      const comment = m.comment ? `<div class="muted">💬 ${esc(m.comment)}</div>` : '';
      return `<tr><td class="tr-name">${esc(m.fullName)}<div class="muted">${esc(m.department || '')}</div></td><td>${AP.badge(cls, label, true)}</td>
        <td class="num">${s ? `${fmt.num(s.done)} از ${fmt.num(s.total)} <span class="muted">(${pct(s)})</span>` : '—'}</td>
        <td class="wrap">${notDone ? `<ul class="plain">${notDone}</ul>` : '—'}${extras}</td><td class="wrap">${comment || '—'}</td><td class="tr-actions">${act}</td></tr>`;
    }).join('');
  }

  // E3: «⚡ تسک فوری» — فقط با مجوز tasks.assign_urgent و نه روی ردیف خودِ کاربر؛ اسکوپ و همه‌ی اعتبارسنجی‌ها سمت سرور (urgentTaskService).
  const urgentBtn = (userId, name) => (AP.can('tasks.assign_urgent') && userId !== (AP.state.me && AP.state.me.id)
    ? `<button type="button" class="btn ghost small" data-act="urgent" data-uid="${userId}" data-name="${esc(name)}">⚡ تسک فوری</button>` : '');

  function openUrgentForm(userId, name, onDone, prefillDate) {
    AP.modal({
      title: `⚡ تسک فوری برای ${name}`,
      body: `<form class="form" id="urgent-form">
        <div class="form-grid">
          <label class="field"><span>عنوان</span><input name="title" required maxlength="120" placeholder="مثلاً: ارسال پیش‌فاکتور به مشتری" /></label>
          <label class="field"><span>تاریخ انجام</span><input type="date" name="date" required value="${esc(prefillDate || fmt.today())}" /></label>
          <label class="field"><span>ساعت مهلت (اختیاری)</span><input type="time" name="deadlineTime" dir="ltr" class="ltr-in" /></label>
          <label class="field"><span>توضیح (اختیاری)</span><textarea name="description" rows="3" maxlength="500"></textarea></label>
        </div>
        <p class="muted">تسک در برنامه‌ی همان روزِ کارمند با برچسب «⚡ فوری» می‌آید و تا ثبت نتیجه، مانع خروج او می‌شود. کارمند نمی‌تواند آن را حذف کند.</p>
        <div class="form-msg"></div>
        <div class="modal-actions"><button class="btn primary" type="submit">ثبت تسک فوری</button><button class="btn ghost" type="button" data-cancel>انصراف</button></div>
      </form>`,
      onMount(body, m) {
        AP.dates.mount(body);
        const form = $('#urgent-form', body);
        $('[data-cancel]', form).addEventListener('click', () => m.close());
        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          const f = AP.formData(form);
          const payload = { title: f.title, date: f.date, ...(f.deadlineTime ? { deadlineTime: f.deadlineTime } : {}), ...(f.description ? { description: f.description } : {}) };
          const r = await AP.attempt(() => AP.api(`/admin/users/${userId}/urgent-tasks`, { method: 'POST', body: payload }), 'تسک فوری ثبت شد و به کارمند اطلاع داده شد.', $('button[type=submit]', form));
          if (!r) return;
          m.close();
          if (onDone) onDone();
        });
      },
    });
  }

  function table(head, body) {
    return `<div class="card flush"><div class="table-wrap"><table><thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table></div></div>`;
  }

  // عنوان بولد بالای هر جدول: <section> = عنوان (+ توضیح کوتاه کنارش) + محتوا
  function section(title, hint, inner, cls = '') {
    return `<section class="tr-section ${cls}"><div class="tr-section-head"><h3 class="tr-title">${title}</h3>${hint ? `<span class="tr-hint">${hint}</span>` : ''}</div>${inner}</section>`;
  }

  // کاشی‌های خلاصه (به‌جای یک خط متن بلند)
  function stat(tone, icon, value, label) {
    return `<div class="stat"><div class="stat-icon ${tone}">${AP.icon(icon)}</div><div class="stat-value u-stat-value-sm">${value}</div><div class="stat-label">${label}</div></div>`;
  }

  function renderResult(r) {
    const canWrite = !r.readOnly && AP.can('reviews.write');
    if (r.tab === 'plan') {
      const body = r.members.map((m) => {
        const [cls, label] = PLAN_STATUS[m.status] || PLAN_STATUS.none;
        const tasks = m.tasks.length ? `<ul class="plain">${m.tasks.map((t) => `<li>${esc(t.title)}${t.plannedDate ? ` <span class="muted">(${esc(fmt.date(t.plannedDate))})</span>` : ''}</li>`).join('')}</ul>` : '—';
        return `<tr><td class="tr-name">${esc(m.fullName)}</td><td>${AP.badge(cls, label, true)}</td><td class="wrap">${tasks}</td><td class="tr-actions">${urgentBtn(m.userId, m.fullName)}</td></tr>`;
      }).join('') || '<tr><td colspan="4" class="muted">موردی برای نمایش نیست.</td></tr>';
      const stats = `<div class="stat-grid tr-stats">${stat('g-green', 'check', fmt.num(r.summary.submitted), 'برنامه ثبت‌شده')}${stat('g-red', 'alert', fmt.num(r.summary.missing), 'برنامه ثبت‌نشده')}</div>`;
      return section('برنامه‌ی هفتگی', `هفته‌ی شروع ${esc(fmt.date(r.weekStart))}`, stats + table(['نام', 'وضعیت', 'تسک‌ها', 'عملیات'], body));
    }
    if (r.tab === 'stuck') {
      const body = r.members.map((m) => `<tr><td class="tr-name">${esc(m.fullName)}</td><td class="wrap"><ul class="plain">${m.tasks.map((t) => `<li>🔴 ${esc(t.title)} — ${fmt.num(t.carriedCount)} بار منتقل‌شده${t.lastReason ? ` <span class="muted">(${esc(REASONS[t.lastReason] || t.lastReason)})</span>` : ''}</li>`).join('')}</ul></td><td class="tr-actions">${urgentBtn(m.userId, m.fullName)}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">تسک معطل‌مانده‌ای نیست.</td></tr>';
      return section('معطل‌مانده‌ها', 'تسک‌هایی که چند بار به روز بعد منتقل شده‌اند', table(['نام', 'تسک‌های معطل‌مانده', 'عملیات'], body));
    }
    const s = r.summary || {};
    const stats = `<div class="stat-grid tr-stats">${stat('g-blue', 'reports', s.percent != null ? `${fmt.num(s.percent)}٪` : '—', 'میانگین انجام')}${stat('g-green', 'check', fmt.num(s.reports || 0), 'گزارش ثبت‌شده')}${stat('g-red', 'alert', fmt.num(s.noReport || 0), 'بدون گزارش')}${stat('g-orange', 'clock', fmt.num(s.unreviewed || 0), 'مشاهده‌نشده')}</div>`;
    const note = r.readOnly ? '<p class="muted tr-note">این صفحه برای شما فقط‌خواندنی است.</p>' : '';
    const title = r.tab === 'unreviewed' ? 'بررسی‌نشده‌ها' : 'گزارش روزانه';
    return section(title, `گزارش روز ${esc(r.date ? fmt.date(r.date) : '—')}`, `${stats}${note}${table(['نام', 'وضعیت', 'انجام', 'انجام‌نشده‌ها / خارج از برنامه', 'کامنت', 'عملیات'], dailyRows(r, canWrite))}`);
  }

  async function load(page, getPickers) {
    const box = $('#tr-result', page);
    box.innerHTML = '<div class="loading"><div class="spinner"></div>در حال بارگذاری…</div>';
    try {
      const q = new URLSearchParams(Object.entries({ tab: ui.tab, date: ui.date, weekStart: ui.weekStart, userId: ui.userId }).filter(([, v]) => v)).toString();
      const r = await AP.api(`/admin/team-reports?${q}`);
      box.innerHTML = renderResult(r);
      // مقدار پیش‌فرضِ سرور (روز کاریِ قبل / هفته‌ی جاری) در تقویم نشان داده شود، نه placeholder
      const form = $('#tr-filters', page);
      const setDef = (name, iso) => { const h = form && form.querySelector(`input[type="hidden"][name="${name}"]`); const dp = getPickers && getPickers()[0]; if (h && dp && !h.value && iso) dp.setValue(iso); };
      if (ui.tab === 'plan') setDef('weekStart', r.weekStart); else setDef('date', r.date);
      $$('[data-act="seen"]', box).forEach((b) => b.addEventListener('click', () => seen(page, r, Number(b.dataset.uid))));
      $$('[data-act="urgent"]', box).forEach((b) => b.addEventListener('click', () => openUrgentForm(Number(b.dataset.uid), b.dataset.name, () => load(page))));
    } catch (err) {
      box.innerHTML = ui.empty(err.message);
    }
  }

  // شاخص‌های مدیریتی (D13): نرخ انجام هر تیم، نرخ بررسی به‌موقع هر سرپرست، برنامه‌ی ثبت‌نشده
  async function loadKpis(page) {
    const box = $('#tr-kpis', page);
    if (!box) return;
    try {
      const k = await AP.api('/admin/task-kpis');
      const rate = (v) => (v == null ? '—' : `${fmt.num(v)}٪`);
      const teams = k.teams.map((t) => `<tr><td>${esc(t.managerName)}</td><td>${fmt.num(t.members)}</td><td>${fmt.num(t.done)} از ${fmt.num(t.planned)}</td><td>${rate(t.completionRate)}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">داده‌ای نیست.</td></tr>';
      const revs = k.reviewers.map((r) => `<tr><td>${esc(r.reviewerName)}</td><td>${fmt.num(r.reports)}</td><td>${fmt.num(r.onTime)}</td><td>${rate(r.onTimeRate)}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">داده‌ای نیست.</td></tr>';
      const names = (list) => (list.length ? ` — ${list.slice(0, 10).map((u) => esc(u.fullName)).join('، ')}` : '');
      box.innerHTML = section('شاخص‌های ۳۰ روز اخیر', 'نمای کلی عملکرد تیم‌ها و سرپرست‌ها', `<div class="tr-kpi-grid">
        ${section('نرخ انجام تیم‌ها', '', `<div class="card flush"><div class="table-wrap"><table><thead><tr><th>تیم</th><th>اعضا</th><th>انجام‌شده</th><th>نرخ انجام</th></tr></thead><tbody>${teams}</tbody></table></div></div>`, 'tr-sub')}
        ${section('بررسی به‌موقع سرپرست‌ها', '', `<div class="card flush"><div class="table-wrap"><table><thead><tr><th>سرپرست</th><th>گزارش‌ها</th><th>بررسی به‌موقع</th><th>نرخ</th></tr></thead><tbody>${revs}</tbody></table></div></div>`, 'tr-sub')}
      </div>
      <div class="tr-callouts">
        <div class="tr-callout"><strong>برنامه‌ی هفته‌ی بعدِ برآورده‌نشده: ${fmt.num(k.unplanned.count)} نفر</strong>${names(k.unplanned.users) ? `<span class="muted">${names(k.unplanned.users).slice(3)}</span>` : ''}</div>
        <div class="tr-callout"><strong>تنظیم‌شده توسط سرپرست، ارسال نهایی نشده: ${fmt.num(k.managerConfiguredNotSubmitted.count)} نفر</strong>${names(k.managerConfiguredNotSubmitted.users) ? `<span class="muted">${names(k.managerConfiguredNotSubmitted.users).slice(3)}</span>` : ''}</div>
      </div>`, 'tr-kpis-section');
    } catch (err) {
      box.innerHTML = ui.empty(err.message);
    }
  }

  async function seen(page, r, userId) {
    const res = await AP.askReason({ title: 'مشاهده‌ی گزارش', label: 'کامنت برای کارمند (اختیاری)', confirmText: 'ثبت «مشاهده شد»', required: false });
    if (res === null || res === undefined || res === false) return;
    const comment = typeof res === 'string' ? res : (res && res.reason) || '';
    const ok = await AP.attempt(() => AP.api('/admin/report-reviews', { method: 'POST', body: { subjectUserId: userId, reportDate: r.date, ...(comment ? { comment } : {}) } }), 'ثبت شد.');
    if (ok !== false) load(page);
  }

  // F2-c: نمای هفتگی کارمند (views-weekly.js) همین فرم را برای «⚡ تسک فوری» روی کارت هر روز صدا می‌زند
  // تا منطق/اعتبارسنجی E3 یک‌جا بماند؛ prefillDate تاریخ همان روز کارت را پیش‌فرض می‌کند.
  AP.openUrgentTaskForm = openUrgentForm;

  AP.view('teamreports', {
    skeleton: 'table',
    perm: 'taskreports.read',
    nav: { icon: 'reports', label: 'گزارش‌های تیم', group: 'گزارش‌ها' },
    async render(param) {
      if (param && /^\d{4}-\d{2}-\d{2}$/.test(param)) { ui.date = param; ui.tab = 'daily'; } // H5-ب: #/teamreports/<YYYY-MM-DD> ⇒ گزارش همان روز
      ui.empty = (msg) => `<div class="empty">${AP.icon('alert')}${esc(msg)}</div>`; // حالت خطا/خالی (S5-9c)
      const users = AP.selfOnly() ? [] : await AP.loadUsers().catch(() => []);
      const managers = users.filter((u) => users.some((x) => x.managerId === u.id)); // تیم = اعضای مستقیم یک سرپرست
      const expParams = () => ({ from: ui.expFrom || fmt.daysAgo(29), to: ui.expTo || fmt.today(), managerId: ui.expManager, userId: ui.expUser });
      const expBar = () => AP.exportBar({ path: '/api/admin/task-report/export', params: expParams(), print: false });
      const html = `
        <div class="view-header"><div><h2>گزارش‌های تیم</h2><div class="sub">برنامه‌ی هفتگی و گزارش روزانه‌ی تسک‌ها؛ پیش‌فرض «روز کاریِ قبل».</div></div>
          <div class="header-actions">${AP.exportBar({ path: '/api/admin/team-reports/export', params: { userId: ui.userId }, print: false })}</div></div>
        <div class="tr-page">
          ${AP.can('analytics.read') ? '<div id="tr-kpis" aria-live="polite"></div>' : ''}
          <section class="tr-section tr-report">
            <div class="tr-tabs" role="tablist" aria-label="نوع گزارش">${TABS.map(([k, l]) => `<button type="button" class="tr-tab${k === ui.tab ? ' active' : ''}" data-tab="${k}" role="tab" aria-selected="${k === ui.tab}">${l}</button>`).join('')}</div>
            <form class="filters card tr-filters" id="tr-filters" aria-label="فیلتر گزارش">
              ${ui.tab === 'plan' ? `<label class="field"><span>هفته (هر روزِ آن)</span><input type="date" name="weekStart" value="${esc(ui.weekStart)}" /></label>` : ''}
              ${ui.tab === 'daily' || ui.tab === 'unreviewed' ? `<label class="field"><span>تاریخ گزارش</span><input type="date" name="date" value="${esc(ui.date)}" /></label>` : ''}
              ${users.length ? `<label class="field"><span>فرد</span><select name="userId"><option value="">همه</option>${users.map((u) => `<option value="${u.id}" ${String(u.id) === String(ui.userId) ? 'selected' : ''}>${esc(u.full_name)}</option>`).join('')}</select></label>` : ''}
            </form>
            <div id="tr-result" aria-live="polite"></div>
          </section>
          <section class="tr-section tr-export-section">
            <div class="tr-section-head"><h3 class="tr-title">خروجی Excel تسک‌ها</h3><span class="tr-hint">بازه‌ی دلخواه را انتخاب و دانلود کنید</span></div>
            <form class="filters card tr-filters" id="tr-export" aria-label="خروجی کامل تسک‌ها">
              <label class="field"><span>از تاریخ</span><input type="date" name="from" value="${esc(ui.expFrom || fmt.daysAgo(29))}" /></label>
              <label class="field"><span>تا تاریخ</span><input type="date" name="to" value="${esc(ui.expTo || fmt.today())}" /></label>
              ${managers.length ? `<label class="field"><span>تیم</span><select name="managerId"><option value="">کل مجموعه</option>${managers.map((m) => `<option value="${m.id}" ${String(m.id) === String(ui.expManager) ? 'selected' : ''}>${esc(m.fullName)}</option>`).join('')}</select></label>` : ''}
              ${users.length ? `<label class="field"><span>فرد</span><select name="expUserId"><option value="">همه</option>${users.map((u) => `<option value="${u.id}" ${String(u.id) === String(ui.expUser) ? 'selected' : ''}>${esc(u.fullName || u.full_name)}</option>`).join('')}</select></label>` : ''}
              <span id="tr-export-bar" class="export-group">${expBar()}</span>
            </form>
          </section>
        </div>`;
      return {
        html,
        mount: (page) => {
          let pickers = [];
          $$('[data-tab]', page).forEach((b) => b.addEventListener('click', () => { ui.tab = b.dataset.tab; AP.refresh(); }));
          // تاریخ‌ها همان تقویم شمسیِ بقیه‌ی پنل؛ قبل از listenerهای صفحه mount می‌شود (قرارداد AP.dates)
          pickers = AP.dates.mount($('#tr-filters', page));
          const exp = $('#tr-export', page);
          AP.dates.mount(exp);
          exp.addEventListener('submit', (e) => e.preventDefault());
          $$('input, select', exp).forEach((el) => el.addEventListener('change', () => {
            const f = AP.formData(exp);
            ui.expFrom = f.from; ui.expTo = f.to; ui.expManager = f.managerId || ''; ui.expUser = f.expUserId || '';
            $('#tr-export-bar', exp).innerHTML = expBar();
          }));
          const form = $('#tr-filters', page);
          form.addEventListener('submit', (e) => e.preventDefault());
          $$('input, select', form).forEach((el) => el.addEventListener('change', () => { Object.assign(ui, AP.formData(form)); load(page, () => pickers); }));
          load(page, () => pickers);
          loadKpis(page);
        },
      };
    },
  });
})();
