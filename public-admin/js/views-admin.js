// گزارش‌ها، ارسال پیام گروهی، تنظیمات، گزارش رویدادها، سیستم.

(function () {
  'use strict';
  const AP = window.AP;
  const { $, $$, esc, fmt } = AP;
  const icon = (n) => AP.icon(n);
  const emptyBox = (text) => `<div class="empty">${AP.icon('inbox')}${esc(text)}</div>`;

  function dailyChart(daily) {
    const W = 720, H = 200, padB = 26, padT = 10;
    const max = Math.max(2, ...daily.map((d) => d.present));
    const n = daily.length;
    const slot = (W - 40) / n;
    const bw = Math.max(3, Math.min(18, slot * 0.6));
    let svg = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="حضور روزانه"><defs><linearGradient id="bar-green" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7be495"/><stop offset="1" stop-color="#16b886"/></linearGradient></defs>`;
    for (let i = 0; i <= 3; i += 1) {
      const y = padT + (H - padT - padB) * (i / 3);
      svg += `<line class="grid" x1="8" x2="${W - 8}" y1="${y}" y2="${y}"/>`;
    }
    const every = Math.ceil(n / 12);
    daily.forEach((d, i) => {
      const cx = W - 30 - (i + 0.5) * slot;
      const h = (H - padT - padB) * (d.present / max);
      svg += `<g><title>${esc(fmt.dateLong(d.date))} — حاضر: ${fmt.num(d.present)}، متأخر: ${fmt.num(d.late)}</title>
        <rect class="bar-a" x="${cx - bw / 2}" y="${H - padB - h}" width="${bw}" height="${h}" rx="3"/></g>`;
      if (i % every === 0) svg += `<text x="${cx}" y="${H - 8}" text-anchor="middle">${new Date(`${d.date}T00:00:00`).toLocaleDateString('fa-IR', { day: 'numeric', month: 'numeric' })}</text>`;
    });
    return `${svg}</svg>`;
  }

  // ======================================================
  // گزارش‌ها
  // ======================================================
  const repUi = { from: null, to: null, department: '', sort: 'totalEffective', dir: -1 };
  AP.view('reports', {
    employee: true,
    nav: { icon: 'reports', label: 'گزارش‌های تحلیلی', group: 'گزارش‌ها' },
    async render() {
      repUi.from = repUi.from || fmt.daysAgo(29);
      repUi.to = repUi.to || fmt.today();
      const qs = new URLSearchParams(Object.entries({ from: repUi.from, to: repUi.to, department: repUi.department }).filter(([, v]) => v)).toString();
      const d = await AP.api(`/admin/reports/summary?${qs}`);
      const t = d.totals;
      const sortKeys = { name: (r) => r.user.fullName, presentDays: (r) => r.presentDays, totalEffective: (r) => r.totalEffective, avgEffective: (r) => r.avgEffective, lateCount: (r) => r.lateCount, earlyLeaveCount: (r) => r.earlyLeaveCount, incompleteCount: (r) => r.incompleteCount, leaveDays: (r) => r.leaveDays, overtimeMinutes: (r) => r.overtimeMinutes };
      const th = (k, l) => `<th class="sortable" data-sort="${k}">${l}${repUi.sort === k ? (repUi.dir > 0 ? ' ▲' : ' ▼') : ''}</th>`;
      const stat = (g, ic, v, l) => `<div class="stat"><div class="stat-icon ${g}">${icon(ic)}</div><div class="stat-value" style="font-size:21px">${v}</div><div class="stat-label">${l}</div></div>`;

      const html = `
        <div class="view-header"><div><h2>گزارش‌های تحلیلی</h2><div class="sub">${esc(fmt.dateLong(d.from))} تا ${esc(fmt.dateLong(d.to))}</div></div>
          <div class="header-actions"><a class="btn ghost" href="/api/admin/reports/export?from=${esc(d.from)}&to=${esc(d.to)}" download>${icon('download')} خروجی CSV خلاصه</a></div></div>
        <form class="filters" id="rep-filters">
          <label class="field"><span>از تاریخ</span><input type="date" name="from" value="${esc(d.from)}" /></label>
          <label class="field"><span>تا تاریخ</span><input type="date" name="to" value="${esc(d.to)}" /></label>
          <label class="field"><span>دپارتمان</span><select name="department"><option value="">همه</option>${d.departmentOptions.map((x) => `<option ${x === repUi.department ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select></label>
          <button type="button" class="btn ghost" data-range="6">۷ روز</button><button type="button" class="btn ghost" data-range="29">۳۰ روز</button><button type="button" class="btn ghost" data-range="89">۹۰ روز</button>
        </form>
        <div class="stat-grid">
          ${stat('g-green', 'in', fmt.num(t.presentDays), 'مجموع روز-نفر حضور')}
          ${stat('g-blue', 'clock', fmt.min(t.totalEffective), 'مجموع ساعت مفید')}
          ${stat('g-blue', 'clock', fmt.min(t.avgEffective), 'میانگین مفید روزانه')}
          ${stat('g-orange', 'alert', fmt.num(t.lateCount), 'ورود با تأخیر')}
          ${stat('g-red', 'out', fmt.num(t.earlyLeaveCount), 'خروج زودهنگام')}
          ${stat('g-purple', 'clock', fmt.min(t.overtimeMinutes), 'اضافه‌کاری')}
          ${stat('g-gray', 'alert', fmt.num(t.incompleteCount), 'رکورد ناقص')}
          ${stat('g-blue', 'leave', fmt.num(t.leaveDays), 'روز مرخصی')}
        </div>
        <div class="card"><h3>تعداد حاضرین به تفکیک روز</h3>${dailyChart(d.daily)}</div>
        <div class="card flush mt"><div style="padding:18px 18px 0"><h3>دپارتمان‌ها</h3></div><div class="table-wrap"><table>
          <thead><tr><th>دپارتمان</th><th>کارمند</th><th>روز-نفر حضور</th><th>ساعت مفید</th><th>تأخیر</th><th>ناقص</th><th>مرخصی</th></tr></thead><tbody>
          ${d.departments.map((x) => `<tr><td>${esc(x.name)}</td><td>${fmt.num(x.employees)}</td><td>${fmt.num(x.presentDays)}</td><td>${fmt.min(x.totalEffective)}</td><td>${fmt.num(x.lateCount)}</td><td>${fmt.num(x.incompleteCount)}</td><td>${fmt.num(x.leaveDays)}</td></tr>`).join('') || `<tr><td colspan="7">${emptyBox('داده‌ای نیست.')}</td></tr>`}</tbody></table></div></div>
        <div class="card flush mt"><div style="padding:18px 18px 0"><h3>جزئیات هر کارمند <span class="muted" style="font-weight:400;font-size:12px">(برای مرتب‌سازی روی عنوان ستون کلیک کنید)</span></h3></div><div class="table-wrap"><table id="rep-table">
          <thead><tr>${th('name', 'کارمند')}${th('presentDays', 'روز حضور')}${th('totalEffective', 'مجموع مفید')}${th('avgEffective', 'میانگین روزانه')}${th('lateCount', 'تأخیر')}${th('earlyLeaveCount', 'خروج زودهنگام')}${th('overtimeMinutes', 'اضافه‌کاری')}${th('incompleteCount', 'ناقص')}${th('leaveDays', 'مرخصی')}<th>میانگین ورود</th></tr></thead><tbody>
          ${[...d.rows].sort((a, b) => {
            const f = sortKeys[repUi.sort] || sortKeys.totalEffective;
            const x = f(a); const y = f(b);
            return (typeof x === 'string' ? x.localeCompare(y, 'fa') : x - y) * repUi.dir;
          }).map((r) => `<tr class="clickable" data-id="${r.user.id}"><td><div class="cell-user">${AP.avatar(r.user.fullName, 'sm')}<span><b>${esc(r.user.fullName)}</b><small>${esc(r.user.department || '')}</small></span></div></td>
            <td>${fmt.num(r.presentDays)}</td><td>${fmt.min(r.totalEffective)}</td><td>${fmt.min(r.avgEffective)}</td><td>${fmt.num(r.lateCount)}</td><td>${fmt.num(r.earlyLeaveCount)}</td>
            <td>${fmt.min(r.overtimeMinutes)}</td><td>${fmt.num(r.incompleteCount)}</td><td>${fmt.num(r.leaveDays)}</td><td class="num">${r.avgCheckIn ? `<span class="ltr">${esc(r.avgCheckIn)}</span>` : '—'}</td></tr>`).join('')}</tbody></table></div></div>`;
      return {
        html,
        mount(page) {
          const form = $('#rep-filters', page);
          $$('input, select', form).forEach((el) => el.addEventListener('change', () => { Object.assign(repUi, AP.formData(form)); AP.refresh(); }));
          $$('[data-range]', form).forEach((b) => b.addEventListener('click', () => { repUi.from = fmt.daysAgo(Number(b.dataset.range)); repUi.to = fmt.today(); AP.refresh(); }));
          $$('th[data-sort]', page).forEach((h) => h.addEventListener('click', () => {
            if (repUi.sort === h.dataset.sort) repUi.dir *= -1; else { repUi.sort = h.dataset.sort; repUi.dir = h.dataset.sort === 'name' ? 1 : -1; }
            AP.refresh();
          }));
          $$('tr[data-id]', page).forEach((tr) => tr.addEventListener('click', () => AP.go('profile', tr.dataset.id)));
        },
      };
    },
  });

  // ======================================================
  // ارسال پیام گروهی
  // ======================================================
  AP.view('broadcast', {
    admin: true,
    nav: { icon: 'broadcast', label: 'ارسال پیام گروهی', group: 'مدیریت', admin: true },
    async render() {
      const users = (await AP.loadUsers()).filter((u) => u.isActive);
      const depts = [...new Set(users.map((u) => u.department).filter(Boolean))];
      const withTg = users.filter((u) => u.telegramUserId);
      const html = `
        <div class="view-header"><div><h2>ارسال پیام گروهی</h2><div class="sub">پیام از طریق بات تلگرام برای کارمندانِ دارای آیدی تلگرام ارسال می‌شود (${fmt.num(withTg.length)} نفر)</div></div></div>
        <div class="card"><form class="form" id="bc-form">
          <div class="form-grid">
            <label class="field"><span>گیرندگان</span><select name="scope" id="bc-scope"><option value="all">همه‌ی کارمندان فعال</option><option value="department">یک دپارتمان</option><option value="users">انتخاب دستی</option></select></label>
            <label class="field hidden" id="bc-dept-wrap"><span>دپارتمان</span><select name="department">${depts.map((d) => `<option>${esc(d)}</option>`).join('')}</select></label>
          </div>
          <div class="recipients hidden" id="bc-users">${withTg.map((u) => `<label class="check-row"><input type="checkbox" value="${u.id}" /> ${esc(u.fullName)}</label>`).join('')}</div>
          <label class="field"><span>متن اطلاعیه</span><textarea name="text" rows="5" required placeholder="مثلاً: فردا به‌دلیل تعطیلی رسمی شرکت تعطیل است."></textarea></label>
          <div class="form-msg"></div>
          <div class="modal-actions"><button class="btn primary" type="submit">${icon('broadcast')} ارسال اطلاعیه</button></div>
        </form></div>`;
      return {
        html,
        mount(page) {
          const scope = $('#bc-scope', page);
          scope.addEventListener('change', () => {
            $('#bc-dept-wrap', page).classList.toggle('hidden', scope.value !== 'department');
            $('#bc-users', page).classList.toggle('hidden', scope.value !== 'users');
          });
          $('#bc-form', page).addEventListener('submit', async (e) => {
            e.preventDefault();
            const f = AP.formData(e.target);
            const userIds = $$('#bc-users input:checked', page).map((c) => Number(c.value));
            if (!(await AP.confirmBox({ title: 'ارسال اطلاعیه', message: 'پیام برای گیرندگان انتخاب‌شده در تلگرام ارسال می‌شود و قابل بازگشت نیست. ادامه می‌دهید؟', confirmText: 'ارسال' }))) return;
            const msg = $('.form-msg', page);
            msg.className = 'form-msg'; msg.textContent = 'در حال ارسال…';
            try {
              const r = await AP.api('/admin/broadcast', { method: 'POST', body: { scope: f.scope, department: f.department, userIds, text: f.text } });
              msg.className = r.failed ? 'form-msg err' : 'form-msg ok';
              msg.textContent = `ارسال شد: ${fmt.num(r.delivered)} از ${fmt.num(r.recipients)} نفر${r.failed ? ` (${fmt.num(r.failed)} ناموفق)` : ''}`;
            } catch (err) { msg.className = 'form-msg err'; msg.textContent = err.message; }
          });
        },
      };
    },
  });

  // ======================================================
  // تنظیمات (S3-9a): گروه‌بندی‌شده بر پایه‌ی GET /admin/settings/items؛ ذخیره با PUT /admin/settings/:key (دلیل اجباری)
  // ======================================================
  const WEEKDAY_ORDER = [[6, 'شنبه'], [0, 'یکشنبه'], [1, 'دوشنبه'], [2, 'سه‌شنبه'], [3, 'چهارشنبه'], [4, 'پنجشنبه'], [5, 'جمعه']];
  const WEEKDAY_NAME = Object.fromEntries(WEEKDAY_ORDER);
  const ENUM_LABELS = {
    lateCountsFrom: { shift_start: 'از ساعت شروع کار', after_grace: 'پس از پایان مهلت' },
    overtimeRounding: { down: 'به پایین', nearest: 'نزدیک‌ترین', up: 'به بالا' },
  };
  // گروه‌هایی که محاسبه‌ی روز را عوض می‌کنند ⇒ روی عدد روزها/ماه‌های گذشته هم اثر دارند (گزارش‌ها همیشه با تنظیمات فعلی محاسبه می‌شوند)
  const IMPACT_GROUPS = new Set(['workHours', 'calendar', 'overtime']);
  const IMPACT_TEXT = 'گزارش‌ها و خلاصه‌ها همیشه با مقدار «فعلی» تنظیمات محاسبه می‌شوند؛ پس با تغییر این بخش، عددهای روزها و ماه‌های گذشته (ساعت مفید، تأخیر، اضافه‌کاری، غیبت) هم عوض می‌شود. خودِ رکوردهای تردد تغییری نمی‌کنند.';
  const COLLAPSED_GROUPS = new Set(['schedule', 'retention']);

  // عنوان کوتاه یک تنظیم (بخش اول توضیح تا اولین «؛» یا «(») برای پیام‌ها و دیالوگ‌ها
  const setShort = (it) => it.description.split(/[؛(]/)[0].trim();
  function setEnumLabel(it, v) { return (ENUM_LABELS[it.key] && ENUM_LABELS[it.key][v]) || v; }

  // مقدار قابل‌نمایش (برای «پیش‌فرض: …»)
  function setShow(it, v) {
    if (it.type === 'boolean') return v ? 'روشن' : 'خاموش';
    if (it.type === 'weekdays') return (v || []).length ? WEEKDAY_ORDER.filter(([d]) => v.includes(d)).map(([, n]) => n).join('، ') : 'هیچ‌کدام';
    if (it.type === 'enum') return setEnumLabel(it, v);
    return String(v);
  }

  // نرمال‌سازی برای مقایسه‌ی «تغییر کرده؟»
  function setNorm(it, v) {
    if (it.type === 'boolean') return v === true || v === 'true' ? 'true' : 'false';
    if (it.type === 'number') { const n = Number(v); return v === '' || Number.isNaN(n) ? `?${v}` : String(n); }
    if (it.type === 'weekdays') return JSON.stringify([...(v || [])].map(Number).sort((a, b) => a - b));
    return String(v == null ? '' : v).trim();
  }

  function setInput(it, v) {
    const k = esc(it.key);
    switch (it.type) {
      case 'boolean':
        return `<select name="${k}" data-key="${k}"><option value="true"${v ? ' selected' : ''}>روشن</option><option value="false"${v ? '' : ' selected'}>خاموش</option></select>`;
      case 'number':
        return `<input type="number" step="any" name="${k}" data-key="${k}" value="${esc(v)}"${it.min !== undefined ? ` min="${it.min}"` : ''}${it.max !== undefined ? ` max="${it.max}"` : ''} class="ltr-in" />`;
      case 'time':
        return `<input type="time" name="${k}" data-key="${k}" value="${esc(v)}" class="ltr-in" />`;
      case 'enum':
        return `<select name="${k}" data-key="${k}">${it.values.map((o) => `<option value="${esc(o)}"${o === v ? ' selected' : ''}>${esc(setEnumLabel(it, o))}</option>`).join('')}</select>`;
      case 'weekdays':
        return `<div class="chk-row" data-key="${k}">${WEEKDAY_ORDER.map(([d, n]) => `<label class="chk"><input type="checkbox" value="${d}"${(v || []).includes(d) ? ' checked' : ''} /> ${n}</label>`).join('')}</div>`;
      default: // cron | string | timezone
        return `<input type="text" name="${k}" data-key="${k}" value="${esc(v)}" dir="ltr" class="ltr-in" autocomplete="off" spellcheck="false" />`;
    }
  }

  function setHint(it) {
    const bits = [`پیش‌فرض: ${setShow(it, it.default)}`];
    if (it.type === 'number' && (it.min !== undefined || it.max !== undefined)) bits.push(`بازه: ${it.min !== undefined ? it.min : '…'} تا ${it.max !== undefined ? it.max : '…'}`);
    if (it.type === 'cron') bits.push('الگوی cron پنج‌بخشی، مثل 0 8 * * *');
    if (it.type === 'timezone') bits.push('نام IANA، مثل Asia/Tehran');
    return bits.join(' · ');
  }

  function setRead(it, row) {
    const el = $(`[data-key="${CSS.escape(it.key)}"]`, row);
    if (!el) return undefined;
    if (it.type === 'weekdays') return $$('input:checked', el).map((c) => Number(c.value));
    return el.value;
  }

  AP.view('settings', {
    admin: true,
    nav: { icon: 'settings', label: 'تنظیمات', group: 'مدیریت', admin: true },
    async render() {
      const data = await AP.api('/admin/settings/items');
      const items = data.items;
      const byKey = Object.fromEntries(items.map((i) => [i.key, i]));
      const drafts = {}; // کلید ← مقدارِ در حال ویرایش (ذخیره‌نشده)
      const groupKeys = Object.keys(data.groups).filter((g) => items.some((i) => i.group === g));
      const draftOf = (it) => (it.key in drafts ? drafts[it.key] : it.value);
      const isDirty = (it) => it.key in drafts && setNorm(it, drafts[it.key]) !== setNorm(it, it.value);

      const rowHtml = (it) => `
        <div class="set-row" data-row="${esc(it.key)}">
          <div class="set-info">
            <div class="set-desc">${esc(it.description)}</div>
            <div class="set-meta"><code class="ltr">${esc(it.key)}</code> · ${esc(setHint(it))}</div>
          </div>
          <div class="set-ctl">${setInput(it, draftOf(it))}</div>
          <div class="set-side">${it.isDefault ? '<span class="muted small">پیش‌فرض</span>' : `${AP.badge('blue', 'تغییر‌یافته')} <button type="button" class="btn ghost small" data-reset="${esc(it.key)}">بازگشت به پیش‌فرض</button>`}</div>
        </div>`;

      const groupBody = (g) => {
        const list = items.filter((i) => i.group === g);
        const notes = [];
        if (IMPACT_GROUPS.has(g)) notes.push(`<div class="note warn">${icon('alert')}<span>${esc(IMPACT_TEXT)}</span></div>`);
        if (g === 'schedule') notes.push(`<div class="note">${icon('clock')}<span>تغییر زمان‌بندی بدون ری‌استارت و بلافاصله اعمال می‌شود. مقدار پیش‌فرض از فایل <code class="ltr">.env</code> می‌آید.</span></div>`);
        return `${notes.join('')}<div class="set-rows">${list.map(rowHtml).join('')}</div>
          <div class="set-foot"><div class="form-msg" data-msg></div>
            <button type="button" class="btn primary" data-save="${esc(g)}" disabled>ذخیره‌ی تغییرات این بخش</button></div>`;
      };

      const html = `
        <div class="view-header"><div><h2>تنظیمات</h2><div class="sub">هر تغییر با ذکر دلیل ذخیره و در «گزارش رویدادها» ثبت می‌شود · تعطیلات در صفحه‌ی «تعطیلات» است</div></div></div>
        <div class="filters"><label class="field grow"><span>جستجو در تنظیمات</span><input type="search" id="set-q" placeholder="مثلاً: اضافه‌کاری، تأخیر، cron …" autocomplete="off" /></label></div>
        <div id="set-groups">${groupKeys.map((g) => `
          <details class="card set-group" data-group="${esc(g)}"${COLLAPSED_GROUPS.has(g) ? '' : ' open'}>
            <summary><h3>${esc(data.groups[g])}</h3><span class="muted small">${fmt.num(items.filter((i) => i.group === g).length)} تنظیم</span></summary>
            <div class="set-body">${groupBody(g)}</div>
          </details>`).join('')}</div>
        <div id="set-none" class="hidden">${emptyBox('تنظیمی با این عبارت پیدا نشد.')}</div>`;

      return {
        html,
        mount(page) {
          const msgOf = (g) => $(`.set-group[data-group="${CSS.escape(g)}"] [data-msg]`, page);
          const refreshSave = (g) => {
            const btn = $(`[data-save="${CSS.escape(g)}"]`, page);
            if (btn) btn.disabled = !items.some((i) => i.group === g && isDirty(i));
          };
          const repaint = (g) => {
            const body = $(`.set-group[data-group="${CSS.escape(g)}"] .set-body`, page);
            body.innerHTML = groupBody(g);
            bind(g);
            refreshSave(g);
            applyFilter();
          };
          const applyReset = (g) => { const m = msgOf(g); if (m) { m.className = 'form-msg'; m.textContent = ''; } };

          function bind(g) {
            const card = $(`.set-group[data-group="${CSS.escape(g)}"]`, page);
            $$('.set-row', card).forEach((row) => {
              const it = byKey[row.dataset.row];
              const onChange = () => {
                drafts[it.key] = setRead(it, row);
                if (!isDirty(it)) delete drafts[it.key];
                row.classList.toggle('dirty', it.key in drafts);
                refreshSave(g);
                applyReset(g);
              };
              $$('input, select', row).forEach((el) => { el.addEventListener('input', onChange); el.addEventListener('change', onChange); });
              if (it.key in drafts) row.classList.add('dirty');
            });
            $$('[data-reset]', card).forEach((b) => b.addEventListener('click', async () => {
              const it = byKey[b.dataset.reset];
              const reason = await AP.askReason({
                title: 'بازگشت به پیش‌فرض',
                message: `«${setShort(it)}» به مقدار پیش‌فرض (${setShow(it, it.default)}) برمی‌گردد. ${IMPACT_GROUPS.has(g) ? IMPACT_TEXT : ''}`,
                confirmText: 'بازگشت به پیش‌فرض',
              });
              if (reason === null) return;
              const r = await AP.attempt(() => AP.api(`/admin/settings/${encodeURIComponent(it.key)}/reset`, { method: 'POST', body: { reason } }), 'به پیش‌فرض برگشت.');
              if (!r) return;
              if (r.item) Object.assign(it, r.item);
              delete drafts[it.key];
              warnScheduler(r);
              repaint(g);
            }));
            $(`[data-save="${CSS.escape(g)}"]`, card).addEventListener('click', () => saveGroup(g));
          }

          function warnScheduler(r) {
            if (r && r.scheduler && r.scheduler.reloaded === false && r.scheduler.reason === 'error') {
              AP.toast('تنظیم ذخیره شد ولی بازسازی زمان‌بندی خطا داد؛ تا ری‌استارت بعدی اعمال نمی‌شود.', true);
            }
          }

          async function saveGroup(g) {
            const dirty = items.filter((i) => i.group === g && isDirty(i));
            if (!dirty.length) return;
            const reason = await AP.askReason({
              title: 'ذخیره‌ی تنظیمات',
              message: `${fmt.num(dirty.length)} تنظیم تغییر می‌کند: ${dirty.map(setShort).join('؛ ')}.${IMPACT_GROUPS.has(g) ? ` ${IMPACT_TEXT}` : ''}`,
              confirmText: 'ذخیره', placeholder: 'مثلاً: تغییر ساعت کار طبق ابلاغیه‌ی مدیریت',
            });
            if (reason === null) return;
            const errors = [];
            let saved = 0;
            for (const it of dirty) {
              try {
                const r = await AP.api(`/admin/settings/${encodeURIComponent(it.key)}`, { method: 'PUT', body: { value: drafts[it.key], reason } });
                if (r.item) Object.assign(it, r.item);
                delete drafts[it.key];
                saved += 1;
                warnScheduler(r);
              } catch (err) { errors.push(err.message); }
            }
            repaint(g);
            const m = msgOf(g);
            if (errors.length) { m.className = 'form-msg err'; m.textContent = `${saved ? `${fmt.num(saved)} مورد ذخیره شد. ` : ''}ذخیره نشد — ${errors.join(' | ')}`; AP.toast(errors[0], true); }
            else { m.className = 'form-msg ok'; m.textContent = `${fmt.num(saved)} تنظیم ذخیره شد.`; AP.toast('تنظیمات ذخیره شد.'); }
          }

          function applyFilter() {
            const q = $('#set-q', page).value.trim().toLowerCase();
            let anyGroup = false;
            $$('.set-group', page).forEach((card) => {
              let shown = 0;
              $$('.set-row', card).forEach((row) => {
                const it = byKey[row.dataset.row];
                const hit = !q || it.description.toLowerCase().includes(q) || it.key.toLowerCase().includes(q);
                row.classList.toggle('hidden', !hit);
                if (hit) shown += 1;
              });
              card.classList.toggle('hidden', shown === 0);
              if (q && shown) card.open = true;
              if (shown) anyGroup = true;
            });
            $('#set-none', page).classList.toggle('hidden', anyGroup);
          }

          groupKeys.forEach(bind);
          $('#set-q', page).addEventListener('input', applyFilter);
        },
      };
    },
  });

  // ======================================================
  // تعطیلات (S3-9b): لیست، افزودن/ویرایش (کامل/نیم‌روز، همه/دپارتمان)، حذف؛ همه با audit سمت سرور
  // ======================================================
  const holUi = { when: 'upcoming' };
  const localToday = () => { const d = new Date(); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };

  AP.view('holidays', {
    admin: true,
    nav: { icon: 'attendance', label: 'تعطیلات', group: 'مدیریت', admin: true },
    async render() {
      const [all, users] = await Promise.all([AP.api('/admin/holidays'), AP.loadUsers()]);
      const today = localToday();
      const depts = [...new Set(users.map((u) => (u.department || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fa'));
      const rows = all.filter((h) => holUi.when === 'all' || (holUi.when === 'upcoming' ? h.holiday_date >= today : h.holiday_date < today));
      if (holUi.when === 'past') rows.reverse();
      const kindBadge = (h) => (h.kind === 'half' ? AP.badge('orange', `نیم‌روز تا ${h.half_end_time}`) : AP.badge('red', 'تعطیلی کامل'));
      const scopeText = (h) => (h.scope === 'department' ? `دپارتمان «${h.department}»` : 'همه‌ی کارمندان');

      const html = `
        <div class="view-header"><div><h2>تعطیلات</h2><div class="sub">تعطیلی کامل روز را غیرکاری می‌کند؛ نیم‌روز فقط ساعت پایان کار همان روز را زودتر می‌کند · ${fmt.num(all.length)} مورد ثبت‌شده</div></div>
          <div class="header-actions"><button class="btn ghost" id="hol-import">${icon('download')} ورود گروهی</button><button class="btn primary" id="hol-add">${icon('plus')} افزودن تعطیلی</button></div></div>
        <form class="filters" id="hol-filters"><label class="field"><span>نمایش</span>
          <select name="when">${[['upcoming', 'از امروز به بعد'], ['past', 'گذشته'], ['all', 'همه']].map(([v, l]) => `<option value="${v}"${holUi.when === v ? ' selected' : ''}>${l}</option>`).join('')}</select></label></form>
        <div class="card flush">${rows.length ? `<div class="table-wrap"><table><thead><tr><th>تاریخ</th><th>عنوان</th><th>نوع</th><th>شامل</th><th></th></tr></thead><tbody>
          ${rows.map((h) => `<tr>
            <td>${esc(fmt.dateLong(h.holiday_date))}<div class="muted small ltr">${esc(h.holiday_date)}</div></td>
            <td>${esc(h.title)}</td><td>${kindBadge(h)}</td><td>${esc(scopeText(h))}</td>
            <td><div class="row-actions"><button class="btn ghost small" data-edit="${h.id}" aria-label="ویرایش">${icon('edit')}</button>
              <button class="btn danger small" data-del="${h.id}" aria-label="حذف">${icon('trash')}</button></div></td></tr>`).join('')}
          </tbody></table></div>` : emptyBox(all.length ? 'در این بازه تعطیلی‌ای نیست.' : 'تعطیلی ثبت نشده است.')}</div>`;

      function openForm(h) {
        const cur = h || { holiday_date: '', title: '', kind: 'full', half_end_time: '12:30', scope: 'all', department: '' };
        const deptList = cur.department && !depts.includes(cur.department) ? [...depts, cur.department] : depts;
        AP.modal({
          title: h ? 'ویرایش تعطیلی' : 'افزودن تعطیلی',
          body: `<form class="form" id="hol-form">
            <div class="form-grid">
              <label class="field"><span>تاریخ (میلادی)</span><input type="date" name="date" required value="${esc(cur.holiday_date)}" /></label>
              <label class="field"><span>عنوان</span><input name="title" required maxlength="100" value="${esc(cur.title)}" placeholder="مثلاً: عید فطر" /></label>
              <label class="field"><span>نوع</span><select name="kind"><option value="full"${cur.kind === 'full' ? ' selected' : ''}>تعطیلی کامل</option><option value="half"${cur.kind === 'half' ? ' selected' : ''}>نیم‌روز</option></select></label>
              <label class="field" data-half><span>ساعت پایان کار در نیم‌روز</span><input type="time" name="halfEndTime" value="${esc(cur.half_end_time || '12:30')}" /></label>
              <label class="field"><span>شامل</span><select name="scope"><option value="all"${cur.scope === 'all' ? ' selected' : ''}>همه‌ی کارمندان</option><option value="department"${cur.scope === 'department' ? ' selected' : ''}>یک دپارتمان</option></select></label>
              <label class="field" data-dept><span>دپارتمان</span><select name="department">${deptList.length ? deptList.map((d) => `<option value="${esc(d)}"${d === cur.department ? ' selected' : ''}>${esc(d)}</option>`).join('') : '<option value="">— هیچ کاربری دپارتمان ندارد —</option>'}</select></label>
            </div>
            <div class="form-msg"></div>
            <div class="modal-actions"><button class="btn primary" type="submit">${h ? 'ذخیره‌ی تغییرات' : 'افزودن'}</button><button class="btn ghost" type="button" data-cancel>انصراف</button></div>
          </form>`,
          onMount(body, m) {
            const form = $('#hol-form', body);
            const sync = () => {
              $('[data-half]', form).classList.toggle('hidden', form.kind.value !== 'half');
              $('[data-dept]', form).classList.toggle('hidden', form.scope.value !== 'department');
            };
            form.kind.addEventListener('change', sync);
            form.scope.addEventListener('change', sync);
            sync();
            $('[data-cancel]', form).addEventListener('click', () => m.close());
            form.addEventListener('submit', async (e) => {
              e.preventDefault();
              const f = AP.formData(form);
              const r = await AP.attempt(() => AP.api(h ? `/admin/holidays/${h.id}` : '/admin/holidays', { method: h ? 'PUT' : 'POST', body: f }), h ? 'تعطیلی ویرایش شد.' : 'تعطیلی اضافه شد.');
              if (!r) return;
              if (r.warning) AP.toast(r.warning, true);
              m.close();
              AP.refresh();
            });
          },
        });
      }


      // S3-9d: ورود گروهی. متن/CSV ⇒ پیش‌نمایش (بدون ذخیره) ⇒ تأیید. هر تغییر در متن، پیش‌نمایش را باطل می‌کند.
      const IMPORT_STATUS = { new: ['green', 'جدید'], duplicate: ['holiday', 'تکراری (قبلاً ثبت شده)'], duplicate_in_input: ['orange', 'تکرار در همین ورودی'], invalid: ['red', 'نامعتبر'] };
      const importKind = (r) => (r.kind === 'half' ? `نیم‌روز تا ${r.halfEndTime}` : 'کامل');
      function importReport(res) {
        const sm = res.summary;
        const head = `<div class="note${sm.invalid ? ' warn' : ''}"><span>${fmt.num(sm.total)} ردیف: ${fmt.num(sm.new)} جدید · ${fmt.num(sm.duplicate + sm.duplicateInInput)} تکراری (نادیده گرفته می‌شود) · ${fmt.num(sm.invalid)} نامعتبر${sm.invalid ? ' — تا اصلاح خطاها ثبت ممکن نیست.' : ''}</span></div>`;
        const body = res.rows.map((r) => {
          const [cls, label] = IMPORT_STATUS[r.status] || ['holiday', r.status];
          if (r.status === 'invalid') return `<tr><td>${fmt.num(r.line)}</td><td colspan="3" class="ltr">${esc(r.input)}</td><td>${AP.badge(cls, label)}<div class="form-msg err">${esc(r.error)}</div></td></tr>`;
          return `<tr><td>${fmt.num(r.line)}</td><td class="ltr">${esc(r.jalali)}<div class="muted small">${esc(r.date)}</div></td><td>${esc(r.title)}</td>
            <td>${esc(importKind(r))} · ${esc(r.scope === 'department' ? `دپارتمان «${r.department}»` : 'همه')}</td>
            <td>${AP.badge(cls, label)}${r.warning ? `<div class="form-msg err">${esc(r.warning)}</div>` : ''}</td></tr>`;
        }).join('');
        return `${head}<div class="table-wrap" style="max-height:320px;overflow:auto"><table><thead><tr><th>خط</th><th>تاریخ</th><th>عنوان</th><th>نوع / شامل</th><th>وضعیت</th></tr></thead><tbody>${body}</tbody></table></div>`;
      }
      function openImport() {
        AP.modal({
          title: 'ورود گروهی تعطیلات', wide: true,
          body: `<form class="form" id="imp-form">
            <p class="muted small" style="margin:0;line-height:2">هر خط یک تعطیلی با <b>تاریخ شمسی</b>: <span class="ltr">1405/01/01 نوروز</span> یا CSV: <span class="ltr">1405/01/03,عنوان,نیم‌روز,11:30,دپارتمان</span>
              (ستون‌های نوع، ساعت پایان و دپارتمان اختیاری‌اند؛ خط‌های خالی و خط‌های شروع‌شده با # نادیده گرفته می‌شوند.)</p>
            <label class="field"><span>فهرست تعطیلات</span><textarea name="text" rows="8" dir="auto" placeholder="1405/01/01 نوروز&#10;1405/01/02 نوروز"></textarea></label>
            <label class="field"><span>یا فایل CSV / متنی</span><input type="file" name="file" accept=".csv,.txt,text/csv,text/plain" /></label>
            <div id="imp-report"></div>
            <div class="form-msg" id="imp-msg"></div>
            <div class="modal-actions"><button class="btn ghost" type="submit" id="imp-preview">پیش‌نمایش</button>
              <button class="btn primary" type="button" id="imp-commit" disabled>ثبت تعطیلی‌ها</button>
              <button class="btn ghost" type="button" data-cancel>انصراف</button></div></form>`,
          onMount(body, m) {
            const form = $('#imp-form', body);
            const report = $('#imp-report', body);
            const msg = $('#imp-msg', body);
            const commitBtn = $('#imp-commit', body);
            const setMsg = (t, cls = '') => { msg.className = `form-msg ${cls}`; msg.textContent = t; };
            const invalidate = () => { commitBtn.disabled = true; report.innerHTML = ''; setMsg(''); };
            const show = (res) => {
              report.innerHTML = importReport(res);
              commitBtn.disabled = !(res.summary.invalid === 0 && res.summary.new > 0);
              commitBtn.textContent = res.summary.new ? `ثبت ${fmt.num(res.summary.new)} تعطیلی` : 'ثبت تعطیلی‌ها';
              if (!res.summary.new && !res.summary.invalid) setMsg('همه‌ی ردیف‌ها قبلاً ثبت شده‌اند؛ چیزی برای ثبت نیست.');
            };
            const call = async (commit) => {
              const text = form.text.value;
              if (!text.trim()) { setMsg('متن یا فایل را وارد کنید.', 'err'); return null; }
              if (text.length > 90000) { setMsg('حجم ورودی زیاد است (حداکثر ۹۰هزار نویسه).', 'err'); return null; }
              try { return await AP.api('/admin/holidays/import', { method: 'POST', body: { text, commit } }); }
              catch (err) {
                if (err.data && err.data.rows) show(err.data);
                setMsg(err.message, 'err');
                return null;
              }
            };
            form.text.addEventListener('input', invalidate);
            form.file.addEventListener('change', async () => {
              const f = form.file.files[0];
              if (!f) return;
              if (f.size > 90000) { setMsg('فایل بزرگ است (حداکثر حدود ۹۰ کیلوبایت).', 'err'); form.file.value = ''; return; }
              form.text.value = await f.text();
              invalidate();
            });
            form.addEventListener('submit', async (e) => {
              e.preventDefault();
              setMsg('در حال بررسی…');
              const res = await call(false);
              if (res) { setMsg(''); show(res); }
            });
            commitBtn.addEventListener('click', async () => {
              commitBtn.disabled = true;
              const res = await call(true);
              if (!res) return;
              AP.toast(`${fmt.num(res.summary.added)} تعطیلی ثبت شد.`);
              m.close();
              AP.refresh();
            });
            $('[data-cancel]', form).addEventListener('click', () => m.close());
          },
        });
      }

      return {
        html,
        mount(page) {
          $('#hol-filters', page).addEventListener('change', (e) => { holUi.when = e.target.value; AP.refresh(); });
          $('#hol-add', page).addEventListener('click', () => openForm(null));
          $('#hol-import', page).addEventListener('click', openImport);
          $$('[data-edit]', page).forEach((b) => b.addEventListener('click', () => openForm(all.find((h) => String(h.id) === b.dataset.edit))));
          $$('[data-del]', page).forEach((b) => b.addEventListener('click', async () => {
            const h = all.find((x) => String(x.id) === b.dataset.del);
            if (!(await AP.confirmBox({ title: 'حذف تعطیلی', message: `تعطیلی «${h ? h.title : ''}» از تقویم حذف شود؟ روز پس از حذف مطابق تقویم عادی کاری حساب می‌شود.`, confirmText: 'حذف', danger: true }))) return;
            const ok = await AP.attempt(() => AP.api(`/admin/holidays/${b.dataset.del}`, { method: 'DELETE' }), 'حذف شد.');
            if (ok) AP.refresh();
          }));
        },
      };
    },
  });

  // ======================================================
  // گزارش رویدادها (Audit)
  // ======================================================
  const auUi = { userId: '', action: '', from: '', to: '', q: '', limit: 200 };
  AP.view('audit', {
    admin: true,
    nav: { icon: 'audit', label: 'گزارش رویدادها', group: 'مدیریت', admin: true },
    async render() {
      const qs = new URLSearchParams(Object.entries(auUi).filter(([, v]) => v)).toString();
      const [rows, actions, users] = await Promise.all([AP.api(`/admin/audit-log?${qs}`), AP.api('/admin/audit-actions'), AP.loadUsers()]);
      const html = `
        <div class="view-header"><div><h2>گزارش رویدادها</h2><div class="sub">لاگ غیرقابل‌ویرایش همه‌ی عملیات حساس · ${fmt.num(rows.length)} مورد نمایش داده می‌شود</div></div>
          <div class="header-actions"><a class="btn ghost" href="/api/admin/audit-log/export?${qs}" download>${icon('download')} خروجی CSV</a></div></div>
        <form class="filters" id="au-filters">
          <label class="field grow"><span>جستجو در جزئیات / IP</span><input type="search" name="q" value="${esc(auUi.q)}" /></label>
          <label class="field"><span>رویداد</span><select name="action"><option value="">همه</option>${actions.map((a) => `<option value="${esc(a.action)}" ${a.action === auUi.action ? 'selected' : ''}>${esc(a.action)} (${fmt.num(a.count)})</option>`).join('')}</select></label>
          <label class="field"><span>کاربر</span><select name="userId"><option value="">همه</option>${users.map((u) => `<option value="${u.id}" ${String(u.id) === String(auUi.userId) ? 'selected' : ''}>${esc(u.fullName)}</option>`).join('')}</select></label>
          <label class="field"><span>از تاریخ</span><input type="date" name="from" value="${esc(auUi.from)}" /></label>
          <label class="field"><span>تا تاریخ</span><input type="date" name="to" value="${esc(auUi.to)}" /></label>
          <label class="field"><span>تعداد</span><select name="limit">${[100, 200, 500, 1000].map((n) => `<option ${n === auUi.limit ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
        </form>
        <div class="card flush"><div class="table-wrap"><table>
          <thead><tr><th>زمان</th><th>کاربر</th><th>رویداد</th><th>IP</th><th>جزئیات</th></tr></thead><tbody>
          ${rows.length ? rows.map((r) => `<tr><td class="num">${esc(fmt.dateTime(r.occurred_at))}</td><td>${esc(r.userFullName || '—')}</td>
            <td>${esc(r.action)}</td><td><span class="ltr muted">${esc(r.ip_address || '—')}</span></td>
            <td class="wrap"><div class="details-box">${esc(r.details || '')}</div></td></tr>`).join('') : `<tr><td colspan="5">${emptyBox('رویدادی پیدا نشد.')}</td></tr>`}
          </tbody></table></div></div>`;
      return {
        html,
        mount(page) {
          const form = $('#au-filters', page);
          let t;
          $$('input, select', form).forEach((el) => el.addEventListener(el.type === 'search' ? 'input' : 'change', () => {
            clearTimeout(t);
            t = setTimeout(() => { const f = AP.formData(form); Object.assign(auUi, f, { limit: Number(f.limit) }); AP.refresh().then(() => { const i = $('#au-filters input[type=search]'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }); }, el.type === 'search' ? 450 : 0);
          }));
        },
      };
    },
  });

  // ======================================================
  // سیستم و پشتیبان‌گیری
  // ======================================================
  const fmtBytes = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
  const fmtUptime = (sec) => {
    const d = Math.floor(sec / 86400); const h = Math.floor((sec % 86400) / 3600); const m = Math.floor((sec % 3600) / 60);
    return [d ? `${fmt.num(d)} روز` : '', h ? `${fmt.num(h)} ساعت` : '', `${fmt.num(m)} دقیقه`].filter(Boolean).join(' و ');
  };
  const TABLE_LABEL = { users: 'کاربران', attendance_records: 'رکوردهای تردد', break_records: 'استراحت‌ها', leave_requests: 'مرخصی/مأموریت', holidays: 'تعطیلات', record_disputes: 'اعتراض‌ها', audit_log: 'رویدادها', settings: 'تنظیمات ذخیره‌شده' };
  const yn = (v, yes, no) => (v ? AP.badge('green', yes) : AP.badge('red', no));

  AP.view('system', {
    admin: true,
    nav: { icon: 'system', label: 'سیستم و پشتیبان', group: 'مدیریت', admin: true },
    async render() {
      const s = await AP.api('/admin/system');
      const html = `
        <div class="view-header"><div><h2>سیستم و پشتیبان‌گیری</h2><div class="sub">وضعیت سرور، دیتابیس و اتصال‌ها</div></div>
          <div class="header-actions"><button type="button" class="btn danger" id="sys-revoke-all">خروج همه‌ی کاربران</button><a class="btn primary" href="/api/admin/system/backup" download>${icon('download')} دانلود نسخه‌ی پشتیبان دیتابیس</a></div></div>
        <div class="grid-2">
          <div class="card"><h3>سرور</h3><div class="kv">
            <div class="kv-row"><span>زمان سرور</span><span>${esc(fmt.dateTime(s.serverTime))}</span></div>
            <div class="kv-row"><span>منطقه‌ی زمانی</span><span class="ltr">${esc(s.timezone)}</span></div>
            <div class="kv-row"><span>مدت روشن بودن</span><span>${esc(fmtUptime(s.uptimeSeconds))}</span></div>
            <div class="kv-row"><span>Node.js</span><span class="ltr">${esc(s.nodeVersion)}</span></div>
            <div class="kv-row"><span>سیستم‌عامل</span><span class="ltr">${esc(s.platform)}</span></div>
            <div class="kv-row"><span>مصرف حافظه</span><span>${fmt.num(s.memoryMb)} مگابایت</span></div>
            <div class="kv-row"><span>محیط اجرا</span><span class="ltr">${esc(s.environment)}</span></div></div></div>
          <div class="card"><h3>اتصال‌ها و امنیت</h3><div class="kv">
            <div class="kv-row"><span>بات تلگرام</span><span>${yn(s.integration.botConfigured, 'متصل', 'توکن تنظیم نشده')}</span></div>
            <div class="kv-row"><span>نام کاربری بات</span><span class="ltr">${esc(s.integration.botUsername ? `@${s.integration.botUsername}` : '—')}</span></div>
            <div class="kv-row"><span>Mini App</span><span class="ltr">${esc(s.integration.miniAppUrl || '—')}</span></div>
            <div class="kv-row"><span>HTTPS مستقیم</span><span>${yn(s.integration.httpsDirect, 'فعال', 'غیرفعال')}</span></div>
            <div class="kv-row"><span>شبکه‌ی مجاز ثبت تردد</span><span class="ltr">${esc(s.integration.allowedNetworkCidr)}</span></div>
            <div class="kv-row"><span>TRUST_PROXY</span><span>${yn(!s.integration.trustProxy, 'خاموش (امن)', 'روشن')}</span></div>
            <div class="kv-row"><span>اعتبار نشست ادمین</span><span>${fmt.num(s.integration.sessionMaxAgeDays)} روز</span></div></div></div>
        </div>
        <div class="grid-2 mt">
          <div class="card"><h3>دیتابیس · ${esc(fmtBytes(s.database.sizeBytes))}</h3><div class="kv">
            ${Object.entries(s.database.tables).map(([k, v]) => `<div class="kv-row"><span>${esc(TABLE_LABEL[k] || k)}</span><span>${fmt.num(v)}</span></div>`).join('')}</div></div>
          <div class="card"><h3>زمان‌بندی کارها (Cron)</h3><div class="kv">
            ${Object.entries(s.cron || {}).map(([k, v]) => `<div class="kv-row"><span class="ltr muted">${esc(k)}</span><span class="ltr">${esc(v)}</span></div>`).join('')}</div></div>
        </div>`;
      return {
        html,
        mount(root) {
          const btn = $('#sys-revoke-all', root);
          if (!btn) return;
          btn.addEventListener('click', async () => {
            const reason = await AP.askReason({
              title: 'خروج همه‌ی کاربران', danger: true, confirmText: 'باطل‌کردن همه‌ی نشست‌ها',
              message: 'نشست ورود همه‌ی کاربران (ادمین‌ها، سرپرستان و کارمندان) به پنل باطل می‌شود و همه باید دوباره وارد شوند. نشست خود شما حفظ می‌شود.',
            });
            if (!reason) return;
            await AP.attempt(() => AP.api('/admin/system/revoke-all-sessions', { method: 'POST', body: { reason } }), 'همه‌ی نشست‌ها باطل شد.');
          });
        },
      };
    },
  });

  // ======================================================
  // وضعیت سیستم (بخش ۲-ج۱): سلامت، Jobها، آخرین خطاها
  // ======================================================
  const STATUS_TEXT = { success: 'موفق', error: 'خطا', running: 'در حال اجرا', interrupted: 'نیمه‌تمام (ری‌استارت)' };
  const STATUS_CLS = { success: 'green', error: 'red', running: 'blue', interrupted: 'orange' };
  const healthBadge = (ok, yes, no) => AP.badge(ok ? 'green' : 'red', ok ? yes : no);

  AP.view('status', {
    admin: true,
    nav: { icon: 'alert', label: 'وضعیت سیستم', group: 'مدیریت', admin: true },
    async render() {
      const s = await AP.api('/admin/system/status');
      const c = s.checks;
      const bot = c.bot;
      const disk = c.disk;
      const backup = c.backup;
      const overall = s.status === 'ok' ? AP.badge('green', 'سالم') : AP.badge('red', 'نیازمند بررسی');

      const jobRows = s.jobs.map((j) => {
        const r = j.lastResult;
        return `<tr><td class="ltr">${esc(j.name)}</td><td class="ltr muted">${esc(j.cron || '—')}</td>
          <td>${r ? AP.badge(STATUS_CLS[r.status] || 'holiday', STATUS_TEXT[r.status] || r.status) : '<span class="muted">هنوز اجرا نشده</span>'}</td>
          <td>${esc(r ? fmt.dateTime(r.at) : '—')}</td><td>${esc(j.lastSuccessAt ? fmt.dateTime(j.lastSuccessAt) : '—')}</td>
          <td>${r && r.durationMs != null ? `${fmt.num(r.durationMs)} ms` : '—'}</td></tr>`;
      }).join('');

      const errRows = s.recentErrors.length
        ? s.recentErrors.map((e) => `<tr><td class="ltr">${esc(e.job_name)}</td><td>${esc(fmt.dateTime(e.finished_at || e.started_at))}</td><td class="ltr" style="white-space:normal;word-break:break-word">${esc(e.error || '—')}</td></tr>`).join('')
        : '<tr><td colspan="3" class="muted" style="text-align:center;padding:18px">خطایی ثبت نشده است.</td></tr>';

      const alertsHtml = s.activeAlerts.length
        ? s.activeAlerts.map((a) => `<div class="kv-row"><span class="ltr">${esc(a.alert_key)}</span><span>${esc(a.detail || '')}</span></div>`).join('')
        : '<div class="muted" style="padding:6px 0">هشدار فعالی وجود ندارد.</div>';

      const html = `
        <div class="view-header"><div><h2>وضعیت سیستم</h2><div class="sub">سلامت دیتابیس، بات، دیسک، بک‌آپ و Jobها · آخرین بررسی ${esc(fmt.dateTime(s.checkedAt))}</div></div>
          <div class="header-actions">${overall}<button type="button" class="btn" id="st-refresh">تازه‌سازی</button></div></div>
        <div class="grid-2">
          <div class="card"><h3>سلامت</h3><div class="kv">
            <div class="kv-row"><span>دیتابیس (خواندن/نوشتن آزمایشی)</span><span>${healthBadge(c.db.ok, 'سالم', 'خطا')}${c.db.detail ? ` <span class="muted ltr">${esc(c.db.detail)}</span>` : ''}</span></div>
            <div class="kv-row"><span>ارتباط بات با تلگرام (polling)</span><span>${bot.applicable ? healthBadge(bot.ok, 'برقرار', 'قطع') : AP.badge('holiday', 'در این پروسه اجرا نمی‌شود')}</span></div>
            ${bot.applicable ? `<div class="kv-row"><span>آخرین ارتباط موفق</span><span>${esc(bot.lastSuccessAt ? fmt.dateTime(bot.lastSuccessAt) : '—')}</span></div>` : ''}
            ${bot.applicable && bot.lastError ? `<div class="kv-row"><span>آخرین خطای polling</span><span class="ltr" style="word-break:break-word">${esc(bot.lastError)}</span></div>` : ''}
            <div class="kv-row"><span>فضای آزاد دیسک</span><span>${disk.freeMb != null ? `${healthBadge(disk.ok, 'کافی', 'کم')} <span class="ltr">${fmt.num(disk.freeMb)} / ${fmt.num(disk.totalMb)} MB</span>` : AP.badge('holiday', 'قابل‌اندازه‌گیری نیست')}</span></div>
            <div class="kv-row"><span>آخرین بک‌آپ</span><span>${backup.lastBackupAt ? `${esc(fmt.dateTime(backup.lastBackupAt))} (${fmt.num(backup.ageHours)} ساعت پیش)` : 'یافت نشد'}${backup.applicable ? ` ${healthBadge(backup.ok, 'به‌روز', 'قدیمی')}` : ' <span class="muted">(بررسی هشدار خاموش است)</span>'}</span></div>
            ${backup.suspect ? `<div class="kv-row"><span>فایل بک‌آپ مشکوک</span><span>${AP.badge('red', 'integrity_check ناموفق')} <span class="ltr">${esc(backup.suspect.file)}</span></span></div>` : ''}
            <div class="kv-row"><span>Jobهای ۷۲ ساعت اخیر</span><span>${healthBadge(c.jobs.ok, 'بدون شکست', `${fmt.num(c.jobs.failing.length)} شکست`)}</span></div></div></div>
          <div class="card"><h3>هشدارهای فعال</h3><div class="kv">${alertsHtml}</div>
            <p class="muted" style="margin:14px 0 0;line-height:1.9">watchdog ${s.watchdog.enabled ? `هر چند دقیقه (<span class="ltr">${esc(s.watchdog.cron)}</span>) به ادمین‌ها در تلگرام هشدار می‌دهد؛ هشدار تکراریِ هر نوع حداکثر هر ${fmt.num(s.watchdog.throttleMinutes)} دقیقه` : 'خاموش است'}.</p></div>
        </div>
        <div class="card flush mt"><div style="padding:18px 18px 0"><h3>Jobهای زمان‌بندی‌شده</h3></div><div class="table-wrap"><table>
          <thead><tr><th>نام</th><th>Cron</th><th>آخرین نتیجه</th><th>زمان آخرین نتیجه</th><th>آخرین موفقیت</th><th>مدت</th></tr></thead><tbody>${jobRows}</tbody></table></div></div>
        <div class="card flush mt"><div style="padding:18px 18px 0"><h3>آخرین خطاهای Job</h3></div><div class="table-wrap"><table>
          <thead><tr><th>Job</th><th>زمان</th><th>خطا</th></tr></thead><tbody>${errRows}</tbody></table></div></div>`;
      return {
        html,
        mount(root) {
          const btn = $('#st-refresh', root);
          if (btn) btn.addEventListener('click', () => AP.refresh());
        },
      };
    },
  });
})();
