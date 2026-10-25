// صفحه‌ی «دورکاری» (R6، فاز ۱۴): صف بررسی ثبت‌های دورکاریِ کارمندان بیرون از شبکه — تأیید، اصلاح ساعت، رد و تأیید دسته‌ای.
// همه‌ی قواعد (اسکوپ نقش، hr فقط‌خواندنی، خود ممنوع، ماه بسته، هم‌پوشانی با حضور حضوری، idempotent) سمت سرور است (remoteWorkAdminService)؛
// UI فقط دکمه‌ها را با canReview هر ردیف نشان می‌دهد و پیام خطای سرور را بی‌تغییر در توست می‌آورد.
// APIها: GET /admin/remote-work[?status&week&userId&limit&offset]، POST /admin/remote-work/:id/approve|reject، POST /admin/remote-work/approve-batch.
(function () {
  'use strict';
  const AP = window.AP;
  const { $, $$, esc, fmt } = AP;

  const PAGE_SIZE = 50;
  const STATUSES = [['pending', 'منتظر بررسی'], ['approved', 'تأیید شده'], ['rejected', 'رد شده'], ['all', 'همه']];
  const STATUS_BADGE = { pending: ['pending', 'منتظر بررسی'], approved: ['approved', 'تأیید شده'], rejected: ['rejected', 'رد شده'] };
  const WEEK_MODES = [['recent', 'هفته‌ی جاری و قبل'], ['all', 'همه‌ی هفته‌ها'], ['pick', 'یک هفته‌ی مشخص']];

  // وضعیت صفحه (بین رفرش‌ها می‌ماند)
  const ui = { status: 'pending', weekMode: 'recent', week: '', userId: '', offset: 0, last: null };

  const emptyBox = (text) => `<div class="empty">${AP.icon('inbox')}${esc(text)}</div>`;

  function query() {
    const q = new URLSearchParams({ status: ui.status, limit: String(PAGE_SIZE), offset: String(ui.offset) });
    if (ui.weekMode === 'all') q.set('week', 'all');
    else if (ui.weekMode === 'pick' && ui.week) q.set('week', ui.week);
    if (ui.userId) q.set('userId', ui.userId);
    return q.toString();
  }

  function timeRange(it) {
    const start = fmt.clock(it.startAt);
    if (!it.endAt) return `${esc(start)} — ${AP.badge('on_break', 'باز (خروج ثبت نشده)')}`;
    const adj = it.approvedStartAt || it.approvedEndAt;
    const base = `${esc(start)} تا ${esc(fmt.clock(it.endAt))}`;
    return adj ? `${base}<div class="muted">اصلاح‌شده: ${esc(fmt.clock(it.approvedStartAt || it.startAt))} تا ${esc(fmt.clock(it.approvedEndAt || it.endAt))}</div>` : base;
  }

  function badges(it) {
    const [cls, label] = STATUS_BADGE[it.status] || ['normal', it.status];
    const out = [AP.badge(cls, label, true)];
    if (it.source === 'bot') out.push(AP.badge('purple', 'از طریق بات'));
    if (it.autoClosed) out.push(AP.badge('holiday', 'بسته‌شده توسط سیستم'));
    if (it.overlapsOnsite) out.push(AP.badge('rejected', 'هم‌پوشانی با حضور حضوری'));
    return out.join(' ');
  }

  function actions(it) {
    if (!it.canReview) return '';
    if (!it.endAt) return '<span class="muted">پس از ثبت خروج قابل بررسی است</span>';
    if (it.overlapsOnsite) {
      return `<button type="button" class="btn primary small" data-act="overlap" data-id="${it.id}">⚖️ تصمیم هم‌پوشانی</button>
        <button type="button" class="btn ghost small" data-act="reject" data-id="${it.id}">رد</button>`;
    }
    return `<button type="button" class="btn primary small" data-act="approve" data-id="${it.id}">تأیید</button>
      <button type="button" class="btn ghost small" data-act="adjust" data-id="${it.id}">اصلاح ساعت</button>
      <button type="button" class="btn ghost small" data-act="reject" data-id="${it.id}">رد</button>`;
  }

  function rowHtml(it) {
    const emp = it.employee;
    const name = emp ? `${esc(emp.fullName)}<div class="muted">${esc(emp.department || '')}${emp.isActive ? '' : ' · غیرفعال'}</div>` : '—';
    const brk = it.breaks.length ? `${fmt.num(it.breakMinutes)} دقیقه استراحت` : 'بدون استراحت';
    const worked = it.workedMinutes == null ? '—' : fmt.min(it.workedMinutes);
    const note = it.reviewNote ? `<div class="muted">💬 ${esc(it.reviewNote)}</div>` : '';
    return `<tr><td>${name}</td><td>${esc(fmt.date(it.workDate))}</td><td dir="auto">${timeRange(it)}</td>
      <td>${esc(worked)}<div class="muted">${esc(brk)}</div></td><td>${badges(it)}${note}</td><td class="row-actions">${actions(it)}</td></tr>`;
  }

  // ---------- عملیات ----------
  const after = () => { AP.refresh(); AP.refreshCounts(); };

  async function approve(it) {
    const ok = await AP.confirmBox({ title: 'تأیید دورکاری', message: `ساعت‌های ${it.employee ? it.employee.fullName : 'کارمند'} در ${fmt.date(it.workDate)} (${fmt.clock(it.startAt)} تا ${fmt.clock(it.endAt)}) تأیید و در حضور و غیاب و حقوق لحاظ می‌شود.`, confirmText: 'تأیید' });
    if (!ok) return;
    const r = await AP.attempt(() => AP.api(`/admin/remote-work/${it.id}/approve`, { method: 'POST', body: {} }), 'دورکاری تأیید شد.');
    if (r) after();
  }

  async function reject(it) {
    const note = await AP.askReason({ title: 'رد دورکاری', label: 'دلیل رد (الزامی — برای کارمند ارسال می‌شود)', confirmText: 'رد کردن', danger: true });
    if (note === null || note === false) return;
    const r = await AP.attempt(() => AP.api(`/admin/remote-work/${it.id}/reject`, { method: 'POST', body: { review_note: note } }), 'دورکاری رد شد و به کارمند اطلاع داده شد.');
    if (r) after();
  }

  // اصلاح ساعت (و تأیید): ساعت‌ها «YYYY-MM-DDTHH:MM» محلی ⇒ ISO/UTC با fmt.fromLocalInput
  function adjust(it) {
    AP.modal({
      title: 'اصلاح ساعت و تأیید',
      body: `<form class="form" id="rw-adjust">
        <p class="muted">ساعت ثبت‌شده‌ی کارمند: ${esc(fmt.clock(it.startAt))} تا ${esc(fmt.clock(it.endAt))}. فقط اگر لازم است تغییر دهید؛ استراحت‌ها به بازه‌ی جدید بریده می‌شوند.</p>
        <div class="form-grid">
          <label class="field"><span>شروع</span><input type="datetime-local" name="start" required value="${esc(fmt.toLocalInput(it.approvedStartAt || it.startAt))}" /></label>
          <label class="field"><span>پایان</span><input type="datetime-local" name="end" required value="${esc(fmt.toLocalInput(it.approvedEndAt || it.endAt))}" /></label>
          <label class="field"><span>یادداشت (اختیاری)</span><textarea name="note" rows="2" maxlength="500"></textarea></label>
        </div>
        <div class="form-msg"></div>
        <div class="modal-actions"><button class="btn primary" type="submit">اصلاح و تأیید</button><button class="btn ghost" type="button" data-cancel>انصراف</button></div>
      </form>`,
      onMount(body, m) {
        AP.dates.mount(body);
        const form = $('#rw-adjust', body);
        $('[data-cancel]', form).addEventListener('click', () => m.close());
        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          const f = AP.formData(form);
          const start = fmt.fromLocalInput(f.start);
          const end = fmt.fromLocalInput(f.end);
          if (!start || !end) { $('.form-msg', form).className = 'form-msg err'; $('.form-msg', form).textContent = 'ساعت شروع و پایان را کامل وارد کنید.'; return; }
          const r = await AP.attempt(() => AP.api(`/admin/remote-work/${it.id}/approve`, { method: 'POST', body: { approved_start_at: start, approved_end_at: end, ...(f.note ? { review_note: f.note } : {}) } }), 'دورکاری با ساعت اصلاح‌شده تأیید شد.', $('button[type=submit]', form));
          if (!r) return;
          m.close();
          after();
        });
      },
    });
  }

  // هم‌پوشانی با حضور حضوری: تصمیم صریح (merge | keep_onsite) با یادداشت الزامی
  function overlap(it) {
    const on = it.onsiteRecord;
    const onsite = on ? `${fmt.clock(on.checkInTime)} تا ${on.checkOutTime ? fmt.clock(on.checkOutTime) : 'خروج ثبت نشده'}` : '—';
    AP.modal({
      title: 'هم‌پوشانی با حضور حضوری',
      body: `<form class="form" id="rw-overlap">
        <p>این کارمند در ${esc(fmt.date(it.workDate))} حضور حضوری هم دارد (${esc(onsite)}) و دورکاری‌اش ${esc(fmt.clock(it.startAt))} تا ${esc(fmt.clock(it.endAt))} ثبت شده است. یکی را انتخاب کنید:</p>
        <label class="check"><input type="radio" name="decision" value="merge" checked /> <span><b>ادغام:</b> ساعت دورکاری به رکورد حضوری اضافه می‌شود (ساعت هم‌زمان یک‌بار شمرده می‌شود).${on && !on.checkOutTime ? ' <span class="muted">— خروج حضوری ثبت نشده؛ ادغام ممکن نیست.</span>' : ''}</span></label>
        <label class="check"><input type="radio" name="decision" value="keep_onsite" /> <span><b>حضوری معتبر بماند:</b> این دورکاری رد می‌شود و رکورد حضوری دست نمی‌خورد.</span></label>
        <label class="field"><span>یادداشت (الزامی)</span><textarea name="note" rows="2" maxlength="500" required></textarea></label>
        <div class="form-msg"></div>
        <div class="modal-actions"><button class="btn primary" type="submit">ثبت تصمیم</button><button class="btn ghost" type="button" data-cancel>انصراف</button></div>
      </form>`,
      onMount(body, m) {
        const form = $('#rw-overlap', body);
        $('[data-cancel]', form).addEventListener('click', () => m.close());
        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          const f = AP.formData(form);
          if (!f.note || !f.note.trim()) { $('.form-msg', form).className = 'form-msg err'; $('.form-msg', form).textContent = 'یادداشت الزامی است.'; return; }
          const r = await AP.attempt(() => AP.api(`/admin/remote-work/${it.id}/approve`, { method: 'POST', body: { overlap_decision: f.decision, review_note: f.note.trim() } }), 'تصمیم ثبت شد.', $('button[type=submit]', form));
          if (!r) return;
          m.close();
          after();
        });
      },
    });
  }

  // تأیید دسته‌ای: همه‌ی pendingهای یک کارمند و/یا یک هفته‌ی مشخص؛ نتیجه (تأییدشده + ردشده‌ها با دلیل) در مودال
  async function batch() {
    const week = ui.weekMode === 'pick' && ui.week ? ui.week : '';
    if (!ui.userId && !week) { AP.toast('برای تأیید دسته‌ای ابتدا یک کارمند یا یک هفته‌ی مشخص را انتخاب کنید.', true); return; }
    const what = [ui.userId ? 'کارمند انتخاب‌شده' : '', week ? `هفته‌ی ${fmt.date(week)}` : ''].filter(Boolean).join(' در ');
    const ok = await AP.confirmBox({ title: 'تأیید دسته‌ای', message: `همه‌ی دورکاری‌های منتظرِ ${what} تأیید می‌شود (بدون اصلاح ساعت). مواردی که تصمیم جداگانه می‌خواهند، مثل هم‌پوشانی با حضور حضوری، تأیید نمی‌شوند و فهرست می‌شوند.`, confirmText: 'تأیید همه' });
    if (!ok) return;
    const r = await AP.attempt(() => AP.api('/admin/remote-work/approve-batch', { method: 'POST', body: { ...(ui.userId ? { user_id: Number(ui.userId) } : {}), ...(week ? { week } : {}) } }));
    if (!r) return;
    const skipped = r.skipped || [];
    AP.modal({
      title: 'نتیجه‌ی تأیید دسته‌ای',
      body: `<p>${fmt.num(r.approved)} دورکاری تأیید شد${skipped.length ? ` و ${fmt.num(skipped.length)} مورد تأیید نشد:` : '.'}</p>
        ${skipped.length ? `<ul class="plain">${skipped.map((s) => `<li>#${fmt.num(s.id)} — ${esc(s.error)}</li>`).join('')}</ul>` : ''}
        ${r.truncated ? '<p class="muted">تعداد موارد بیش از سقف یک اجرا بود؛ دوباره اجرا کنید.</p>' : ''}
        <div class="modal-actions"><button type="button" class="btn primary" data-close>بستن</button></div>`,
      onMount(body, m) { $('[data-close]', body).addEventListener('click', () => m.close()); },
    });
    after();
  }

  // ---------- لیست ----------
  async function load(page) {
    const box = $('#rw-result', page);
    box.innerHTML = '<div class="loading"><div class="spinner"></div>در حال بارگذاری…</div>';
    try {
      const r = await AP.api(`/admin/remote-work?${query()}`);
      ui.last = r;
      const rows = r.items.length
        ? r.items.map(rowHtml).join('')
        : `<tr><td colspan="6">${emptyBox('ثبت دورکاری‌ای با این فیلتر پیدا نشد.')}</td></tr>`;
      const from = r.total ? r.offset + 1 : 0;
      const to = r.offset + r.items.length;
      const pager = r.total > PAGE_SIZE
        ? `<div class="row-actions"><button type="button" class="btn ghost small" data-page="prev" ${r.offset <= 0 ? 'disabled' : ''}>قبلی</button>
            <span class="muted">${fmt.num(from)} تا ${fmt.num(to)} از ${fmt.num(r.total)}</span>
            <button type="button" class="btn ghost small" data-page="next" ${to >= r.total ? 'disabled' : ''}>بعدی</button></div>` : '';
      const readOnly = r.items.length && !r.items.some((i) => i.canReview) && ui.status === 'pending' ? '<p class="muted">این صف برای شما فقط‌خواندنی است.</p>' : '';
      box.innerHTML = `${readOnly}<div class="card flush"><div class="table-wrap"><table>
        <thead><tr><th>کارمند</th><th>روز</th><th>ساعت ثبت‌شده</th><th>کار خالص</th><th>وضعیت</th><th></th></tr></thead><tbody>${rows}</tbody></table></div></div>${pager}`;
      const byId = new Map(r.items.map((i) => [String(i.id), i]));
      const handlers = { approve, reject, adjust, overlap };
      $$('[data-act]', box).forEach((b) => b.addEventListener('click', () => handlers[b.dataset.act](byId.get(b.dataset.id))));
      $$('[data-page]', box).forEach((b) => b.addEventListener('click', () => {
        ui.offset = Math.max(0, ui.offset + (b.dataset.page === 'next' ? PAGE_SIZE : -PAGE_SIZE));
        load(page);
      }));
    } catch (err) {
      box.innerHTML = emptyBox(err.message);
    }
  }

  // ثبت دستی دورکاری (فقط remote_work.create = ادمین): نشستِ تأییدشده برای یک کارمند؛ ساعت‌ها «YYYY-MM-DDTHH:MM» محلی ⇒ ISO/UTC با fmt.fromLocalInput.
  // همه‌ی قواعد (ماه بسته، آینده، ۲۴ ساعت، هم‌پوشانی، خود ممنوع) سمت سرور است؛ پیام خطای سرور بی‌تغییر در مودال نشان داده می‌شود.
  function addManual(users) {
    const meId = AP.state.me && AP.state.me.id;
    const options = users.filter((u) => u.isActive !== false && String(u.id) !== String(meId))
      .map((u) => `<option value="${esc(u.id)}">${esc(u.full_name || u.fullName || u.id)}</option>`).join('');
    AP.modal({
      title: 'ثبت دستی دورکاری',
      body: `<form class="form" id="rw-manual">
        <p class="muted">دورکاری با همین ساعت‌ها برای کارمند «تأییدشده» ثبت می‌شود و در حضور و غیاب و گزارش‌ها حساب می‌شود؛ کارمند هم اعلان می‌گیرد. ثبت برای خودتان ممکن نیست.</p>
        <div class="form-grid">
          <label class="field full"><span>کارمند</span><select name="userId" required><option value="">انتخاب کنید…</option>${options}</select></label>
          <label class="field"><span>شروع</span><input type="datetime-local" name="start" required /></label>
          <label class="field"><span>پایان</span><input type="datetime-local" name="end" required /></label>
          <label class="field full"><span>دلیل ثبت (الزامی)</span><textarea name="note" rows="2" maxlength="500" required></textarea></label>
          <label class="field full"><span>اگر همان روز حضور حضوری هم دارد</span><select name="decision"><option value="">خطا بده (ثبت نشود)</option><option value="merge">ادغام با رکورد حضوری</option></select></label>
        </div>
        <div class="form-msg"></div>
        <div class="modal-actions"><button class="btn primary" type="submit">ثبت دورکاری</button><button class="btn ghost" type="button" data-cancel>انصراف</button></div>
      </form>`,
      onMount(body, m) {
        AP.dates.mount(body);
        const form = $('#rw-manual', body);
        const msg = (t) => { const e = $('.form-msg', form); e.className = 'form-msg err'; e.textContent = t; };
        $('[data-cancel]', form).addEventListener('click', () => m.close());
        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          const f = AP.formData(form);
          const start = fmt.fromLocalInput(f.start);
          const end = fmt.fromLocalInput(f.end);
          if (!f.userId) { msg('کارمند را انتخاب کنید.'); return; }
          if (!start || !end) { msg('ساعت شروع و پایان را کامل وارد کنید.'); return; }
          if (!String(f.note || '').trim()) { msg('دلیل ثبت را بنویسید.'); return; }
          const r = await AP.attempt(() => AP.api('/admin/remote-work', { method: 'POST', body: { user_id: Number(f.userId), start_at: start, end_at: end, review_note: f.note.trim(), ...(f.decision ? { overlap_decision: f.decision } : {}) } }), 'دورکاری ثبت و تأیید شد.');
          if (!r) return;
          m.close();
          after();
        });
      },
    });
  }

  AP.view('remote', {
    skeleton: 'table',
    perm: 'remote_work.read',
    nav: { icon: 'clock', label: 'دورکاری', group: 'درخواست‌ها', counter: true },
    async render() {
      const users = AP.selfOnly() ? [] : await AP.loadUsers().catch(() => []);
      const canReview = AP.can('remote_work.review');
      const canCreate = AP.can('remote_work.create');
      const html = `
        <div class="view-header"><div><h2>دورکاری</h2>
          <div class="sub">ساعت‌هایی که کارمندان بیرون از شبکه ثبت کرده‌اند؛ تا تأیید شما در حضور و غیاب، گزارش‌ها و حقوق حساب نمی‌شوند.${canReview ? '' : ' (فقط‌خواندنی)'}</div></div>
          <div class="header-actions">${canCreate ? '<button type="button" class="btn ghost" id="rw-add">ثبت دستی دورکاری</button>' : ''}${canReview ? '<button type="button" class="btn primary" id="rw-batch">تأیید دسته‌ای</button>' : ''}</div></div>
        <div class="chips" id="rw-chips">${STATUSES.map(([k, l]) => `<button type="button" class="chip ${k === ui.status ? 'active' : ''}" data-s="${k}">${l}</button>`).join('')}</div>
        <form class="filters" id="rw-filters">
          <label class="field"><span>بازه</span><select name="weekMode">${WEEK_MODES.map(([k, l]) => `<option value="${k}" ${k === ui.weekMode ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
          <label class="field"><span>هفته (هر روزِ آن)</span><input type="date" name="week" value="${esc(ui.week)}" /></label>
          ${users.length ? `<label class="field"><span>کارمند</span><select name="userId"><option value="">همه</option>${users.map((u) => `<option value="${u.id}" ${String(u.id) === String(ui.userId) ? 'selected' : ''}>${esc(u.full_name || u.fullName || u.id)}</option>`).join('')}</select></label>` : ''}
        </form>
        <div id="rw-result" aria-live="polite"></div>`;
      return {
        html,
        mount(page) {
          AP.dates.mount(page);
          $('#rw-chips', page).addEventListener('click', (e) => {
            const c = e.target.closest('[data-s]');
            if (c) { ui.status = c.dataset.s; ui.offset = 0; AP.refresh(); }
          });
          const form = $('#rw-filters', page);
          form.addEventListener('submit', (e) => e.preventDefault());
          $$('input, select', form).forEach((el) => el.addEventListener('change', () => {
            const f = AP.formData(form);
            ui.weekMode = f.weekMode;
            ui.week = f.week || '';
            if (ui.week && ui.weekMode === 'recent') { ui.weekMode = 'pick'; $('select[name=weekMode]', form).value = 'pick'; } // انتخاب تاریخ ⇒ «یک هفته‌ی مشخص»
            ui.userId = f.userId || '';
            ui.offset = 0;
            load(page);
          }));
          const b = $('#rw-batch', page);
          if (b) b.addEventListener('click', batch);
          const ad = $('#rw-add', page);
          if (ad) ad.addEventListener('click', () => addManual(users));
          load(page);
        },
      };
    },
  });
})();
