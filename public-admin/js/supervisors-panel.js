// فاز C (مرحله ۴): «فهرست سرپرست‌ها و تیم‌ها» بالای بخش «سرپرست‌ها» در تنظیمات (فقط با مجوز supervisors.manage).
// views-admin.js فقط یک نقطه‌ی اتصال خالی می‌سازد و اگر این فایل بارگذاری شده باشد AP.supervisorsPanel.mount را صدا می‌زند.
// همه‌ی داده‌ها با esc() وارد HTML می‌شوند؛ هر نوشتن: پیش‌نمایش (dryRun سمت سرور) ← دلیل (AP.askReason) ← ارسال.

(function () {
  'use strict';
  const AP = window.AP;
  const { $, $$, esc, fmt } = AP;
  const icon = (n) => AP.icon(n);
  const ROLE_LABEL = { manager: 'سرپرست', admin: 'ادمین', owner: 'مالک', hr: 'منابع انسانی', employee: 'کارمند' };
  const num = (n) => fmt.num(n);

  const lastLogin = (v) => {
    if (!v) return '—';
    try { return fmt.dateTime(String(v).includes('T') ? v : `${String(v).replace(' ', 'T')}Z`); } catch (_) { return '—'; }
  };

  function reviewCell(r) {
    if (!r || !r.applicable) return '<span class="muted">—</span>';
    return r.viewed
      ? AP.badge('green', 'مشاهده شده', true)
      : AP.badge('orange', `${num(r.unreviewed)} گزارش مشاهده‌نشده`, true);
  }

  function editCell(q) {
    if (!q) return '<span class="muted">—</span>';
    return `<bdi dir="ltr">${esc(num(q.used))}/${esc(q.unlimited ? '∞' : num(q.limit))}</bdi>`;
  }

  // جانشین ثبت‌شده زیر نام سرپرست (فقط نمایش)؛ covering = همین الان جایگزین است
  function deputyLine(s) {
    if (!s.deputy) return '';
    return `<div class="muted small">جانشین: ${esc(s.deputy.fullName)}${!s.deputy.isActive ? ` ${AP.badge('gray', 'غیرفعال', true)}` : ''}${s.deputy.covering ? ` ${AP.badge('orange', 'در حال جانشینی', true)}` : ''}</div>`;
  }

  const boolLabel = (v) => (v === true ? 'روشن' : v === false ? 'خاموش' : '—');

  function rowHtml(s) {
    const nameBadges = [
      s.label && s.role !== 'manager' ? AP.badge('blue', s.label) : '',
      !s.isActive ? AP.badge('gray', 'غیرفعال') : '',
    ].join(' ');
    return `<tr data-sup="${esc(s.id)}">
      <td data-label="سرپرست"><a class="u-link-inherit" href="#/profile/${esc(s.id)}">${esc(s.fullName)}</a> ${nameBadges}<div class="muted small">${esc(ROLE_LABEL[s.role] || s.role)}</div>${deputyLine(s)}</td>
      <td data-label="دپارتمان">${esc(s.department || '—')}</td>
      <td data-label="اعضا">${esc(num(s.activeMembers))} <span class="muted small">از ${esc(num(s.totalMembers))}</span></td>
      <td data-label="در انتظار تأیید">${s.pendingRequests ? AP.badge('orange', num(s.pendingRequests)) : '<span class="muted">۰</span>'}</td>
      <td data-label="گزارش روز قبل">${reviewCell(s.review)}</td>
      <td data-label="اصلاح این ماه">${editCell(s.recordEdit)}</td>
      <td data-label="آخرین ورود">${esc(lastLogin(s.lastLoginAt))}</td>
      <td data-label="عملیات" class="sup-actions">
        <button type="button" class="btn ghost small" data-act="view">مشاهده‌ی تیم</button>
        <button type="button" class="btn ghost small" data-act="add">افزودن عضو</button>
        <button type="button" class="btn ghost small" data-act="transfer"${s.totalMembers ? '' : ' disabled'}>انتقال تیم</button>
        <button type="button" class="btn ghost small" data-act="role">نقش/وضعیت</button>
        ${s.role === 'manager' ? '<button type="button" class="btn ghost small" data-act="deputy">جانشین</button><button type="button" class="btn ghost small" data-act="overrides">استثناها</button>' : ''}
        <a class="btn ghost small" href="#/profile/${esc(s.id)}">ویرایش پروفایل</a>
      </td>
    </tr>`;
  }

  // ---------- پیش‌نمایش ----------
  function previewHtml(p, verb) {
    const lines = [];
    lines.push(`<p><strong>${esc(num(p.count))}</strong> نفر ${esc(verb)}${p.to ? ` به «${esc(p.to.fullName)}»` : ' و بدون سرپرست می‌شوند'}.${p.unchangedCount ? ` (${esc(num(p.unchangedCount))} نفر از قبل همین سرپرست را دارند و تغییری نمی‌کنند.)` : ''}</p>`);
    lines.push(`<p class="muted small">درخواست‌های در انتظارِ این کارمندان: <strong>${esc(num(p.pendingRequests))}</strong>. ${esc(p.note)}</p>`);
    lines.push(`<ul class="sup-prev-list">${p.members.slice(0, 40).map((m) => `<li>${esc(m.fullName)} <span class="muted small">${m.fromSupervisor ? `از «${esc(m.fromSupervisor)}»` : 'بدون سرپرست'}</span></li>`).join('')}</ul>`);
    if (p.members.length > 40) lines.push(`<p class="muted small">و ${esc(num(p.members.length - 40))} نفر دیگر…</p>`);
    return lines.join('');
  }

  // مودال پیش‌نمایش با پاراگراف‌های HTML امن (esc شده)
  function previewModal(title, p, verb, confirmText) {
    return new Promise((resolve) => {
      let done = false;
      const finish = (v) => { if (!done) { done = true; resolve(v); } };
      const m = AP.modal({
        title, top: true,
        body: `<div class="sup-preview">${previewHtml(p, verb)}</div>
          <div class="modal-actions"><button type="button" class="btn primary" data-ok>${esc(confirmText)}</button>
          <button type="button" class="btn ghost" data-cancel>انصراف</button></div>`,
        onMount(body, h) {
          $('[data-ok]', body).addEventListener('click', () => { finish(true); h.close(); });
          $('[data-cancel]', body).addEventListener('click', () => h.close());
        },
      });
      m.onClose = () => finish(false);
    });
  }

  // انتخاب چندنفره با جستجو؛ خروجی: آرایه‌ی شناسه یا null
  function pickUsers({ title, users, hint, confirmText = 'ادامه' }) {
    return new Promise((resolve) => {
      let done = false;
      const finish = (v) => { if (!done) { done = true; resolve(v); } };
      const m = AP.modal({
        title, wide: true,
        body: `<div class="form">
          ${hint ? `<p class="muted small">${esc(hint)}</p>` : ''}
          <label class="field"><span class="sr-only">جستجو</span><input type="search" data-q placeholder="جستجوی نام…" autocomplete="off" /></label>
          <div class="sup-pick" role="group" aria-label="${esc(title)}">${users.length ? users.map((u) => `<label class="sup-pick-row" data-name="${esc(u.fullName.toLowerCase())}"><input type="checkbox" value="${esc(u.id)}" /> <span>${esc(u.fullName)}</span> <span class="muted small">${esc(u.department || '')}${u.supName ? ` · سرپرست فعلی: ${esc(u.supName)}` : ''}</span></label>`).join('') : '<p class="muted">کارمندی برای انتخاب نیست.</p>'}</div>
          <div class="form-msg" data-msg aria-live="polite"></div>
          <div class="modal-actions"><button type="button" class="btn primary" data-ok>${esc(confirmText)}</button>
          <button type="button" class="btn ghost" data-cancel>انصراف</button></div></div>`,
        onMount(body, h) {
          $('[data-q]', body).addEventListener('input', (e) => {
            const q = e.target.value.trim().toLowerCase();
            $$('.sup-pick-row', body).forEach((r) => { r.hidden = !!q && !r.dataset.name.includes(q); });
          });
          $('[data-cancel]', body).addEventListener('click', () => h.close());
          $('[data-ok]', body).addEventListener('click', () => {
            const ids = $$('input[type=checkbox]:checked', body).map((c) => Number(c.value));
            if (!ids.length) { const msg = $('[data-msg]', body); msg.className = 'form-msg err'; msg.textContent = 'حداقل یک نفر را انتخاب کنید.'; return; }
            finish(ids); h.close();
          });
        },
      });
      m.onClose = () => finish(null);
    });
  }

  function chooseTarget({ title, supervisors, excludeId, allowNone, message }) {
    return new Promise((resolve) => {
      let done = false;
      const finish = (v) => { if (!done) { done = true; resolve(v); } };
      const opts = supervisors.filter((s) => s.id !== excludeId && s.isActive).map((s) => `<option value="${esc(s.id)}">${esc(s.fullName)} (${esc(ROLE_LABEL[s.role] || s.role)})</option>`).join('');
      const m = AP.modal({
        title,
        body: `<form class="form">${message ? `<p class="muted small">${esc(message)}</p>` : ''}
          <label class="field"><span>سرپرست مقصد</span><select name="to">${allowNone ? '<option value="">— بدون سرپرست —</option>' : ''}${opts}</select></label>
          <fieldset class="field"><legend>اعضای انتقال</legend>
            <label><input type="radio" name="scope" value="all" checked /> همه‌ی اعضای تیم</label>
            <label><input type="radio" name="scope" value="some" /> انتخاب اعضا</label></fieldset>
          <div class="modal-actions"><button type="submit" class="btn primary">ادامه</button>
          <button type="button" class="btn ghost" data-cancel>انصراف</button></div></form>`,
        onMount(body, h) {
          $('[data-cancel]', body).addEventListener('click', () => h.close());
          $('form', body).addEventListener('submit', (e) => {
            e.preventDefault();
            const to = $('[name=to]', body).value;
            finish({ to: to ? Number(to) : null, all: $('[name=scope]:checked', body).value === 'all' });
            h.close();
          });
        },
      });
      m.onClose = () => finish(null);
    });
  }

  AP.supervisorsPanel = {
    html() {
      return `<section class="st-sup" data-sup-panel aria-labelledby="st-sup-h">
        <div class="st-sup-head"><h4 id="st-sup-h">فهرست سرپرست‌ها و تیم‌ها</h4>
          <button type="button" class="btn ghost small" data-sup-refresh>${icon('refresh')} تازه‌سازی</button></div>
        <p class="muted small">انتقال یا افزودن عضو، درخواست‌های در انتظار را خودکار به سرپرست جدید می‌برد. هر تغییر با دلیل در گزارش رویدادها ثبت می‌شود.</p>
        <div data-sup-body aria-live="polite"><div class="muted">در حال بارگذاری…</div></div>
      </section>`;
    },

    mount(page) {
      const root = $('[data-sup-panel]', page);
      if (!root) return;
      const body = $('[data-sup-body]', root);
      let data = null;

      const toast = (msg, err) => AP.toast(msg, !!err);
      const supById = (id) => data && data.supervisors.find((s) => s.id === id);

      async function load() {
        try {
          data = await AP.api('/admin/supervisors');
        } catch (err) { body.innerHTML = `<div class="form-msg err">${esc(err.message)}</div>`; return; }
        paint();
      }

      function paint() {
        const un = data.unassigned;
        body.innerHTML = `${data.supervisors.length ? `<div class="table-wrap"><table data-stack>
            <thead><tr><th>سرپرست</th><th>دپارتمان</th><th>اعضا</th><th>در انتظار تأیید</th><th>گزارش روز قبل</th><th>اصلاح این ماه</th><th>آخرین ورود</th><th>عملیات</th></tr></thead>
            <tbody>${data.supervisors.map(rowHtml).join('')}</tbody></table></div>` : '<div class="empty">سرپرستی ثبت نشده است.</div>'}
          <div class="st-sup-un"><strong>کارمندان بدون سرپرست:</strong> ${esc(num(un.count))} نفر
            ${un.count ? '<button type="button" class="btn ghost small" data-act-un>نمایش و تخصیص</button>' : ''}</div>`;
      }

      async function usersWithSup(filter) {
        const users = await AP.loadUsers(true);
        const names = new Map(users.map((u) => [u.id, u.fullName]));
        return users.filter((u) => u.role !== 'owner' && filter(u)).map((u) => ({ ...u, supName: u.managerId ? names.get(u.managerId) || null : null }));
      }

      async function doMove({ path, bodyBase, verb, title, confirmText, doneMsg }) {
        const p = await AP.api(path, { method: 'POST', body: { ...bodyBase, dryRun: true } });
        if (!p.count) { toast('عضوی برای جابه‌جایی نیست.', true); return; }
        if (!(await previewModal(title, p, verb, confirmText))) return;
        const reason = await AP.askReason({ title, message: `${num(p.count)} نفر جابه‌جا می‌شوند.`, confirmText, placeholder: 'مثلاً: مرخصی طولانی سرپرست' });
        if (reason === null) return;
        const r = await AP.api(path, { method: 'POST', body: { ...bodyBase, reason } });
        toast(`${doneMsg} (${num(r.moved)} نفر)`);
        await load();
      }

      async function actAdd(s) {
        const team = await AP.api(`/admin/supervisors/${s.id}`);
        const inTeam = new Set(team.members.map((m) => m.id));
        const users = await usersWithSup((u) => u.id !== s.id && !inTeam.has(u.id) && u.isActive !== false);
        const ids = await pickUsers({ title: `افزودن عضو به تیم «${s.fullName}»`, users, hint: 'کارمندی که سرپرست دیگری دارد به این سرپرست منتقل می‌شود.' });
        if (!ids) return;
        await doMove({ path: `/admin/supervisors/${s.id}/members`, bodyBase: { userIds: ids }, verb: 'به تیم اضافه', title: 'افزودن عضو', confirmText: 'افزودن', doneMsg: 'اعضا اضافه شدند' });
      }

      async function actTransfer(s) {
        const t = await chooseTarget({ title: `انتقال تیم «${s.fullName}»`, supervisors: data.supervisors, excludeId: s.id, allowNone: true, message: 'مقصد باید سرپرست، ادمین یا مالکِ فعال باشد؛ «بدون سرپرست» یعنی فقط ادمین‌ها تأیید می‌کنند.' });
        if (!t) return;
        let bodyBase = { toSupervisorId: t.to, all: true };
        if (!t.all) {
          const team = await AP.api(`/admin/supervisors/${s.id}`);
          const ids = await pickUsers({ title: 'انتخاب اعضای انتقال', users: team.members.map((m) => ({ ...m, supName: null })) });
          if (!ids) return;
          bodyBase = { toSupervisorId: t.to, userIds: ids };
        }
        await doMove({ path: `/admin/supervisors/${s.id}/transfer`, bodyBase, verb: 'منتقل', title: 'انتقال تیم', confirmText: 'انتقال', doneMsg: 'تیم منتقل شد' });
      }

      async function actView(s) {
        const t = await AP.api(`/admin/supervisors/${s.id}`);
        AP.modal({
          title: `تیم «${s.fullName}»`, wide: true,
          body: `<p class="muted small">${esc(num(t.members.length))} عضو · ${esc(num(t.pendingRequests))} درخواست در انتظار</p>
            ${t.members.length ? `<div class="table-wrap"><table data-stack><thead><tr><th>نام</th><th>دپارتمان</th><th>وضعیت</th><th>در انتظار</th></tr></thead><tbody>${t.members.map((m) => `<tr><td data-label="نام"><a class="u-link-inherit" href="#/profile/${esc(m.id)}">${esc(m.fullName)}</a></td><td data-label="دپارتمان">${esc(m.department || '—')}</td><td data-label="وضعیت">${m.isActive ? 'فعال' : AP.badge('gray', 'غیرفعال')}</td><td data-label="در انتظار">${esc(num(m.pendingRequests))}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">این سرپرست عضوی ندارد.</div>'}`,
        });
      }

      // تغییر نقش (کارمند/سرپرست) و فعال/غیرفعال با همان PATCH /admin/users/:id
      function actRole(s) {
        const me = AP.state.me || {};
        const privileged = ['admin', 'owner'].includes(s.role);
        const locked = s.id === me.id || (privileged && !AP.isOwnerMe());
        const m = AP.modal({
          title: `نقش و وضعیت «${s.fullName}»`,
          body: `<form class="form">
            ${locked ? '<p class="muted small">تغییر نقش/وضعیت این حساب از اینجا مجاز نیست (حساب خودتان یا ادمین/مالک؛ مدیریت ادمین‌ها فقط با owner).</p>' : ''}
            <label class="field"><span>نقش</span><select name="role" ${locked || privileged ? 'disabled' : ''}>
              ${['manager', 'employee'].map((r) => `<option value="${r}" ${s.role === r ? 'selected' : ''}>${esc(ROLE_LABEL[r])}</option>`).join('')}
              ${privileged ? `<option selected>${esc(ROLE_LABEL[s.role])}</option>` : ''}</select></label>
            <label class="field"><span><input type="checkbox" name="active" ${s.isActive ? 'checked' : ''} ${locked ? 'disabled' : ''} /> حساب فعال باشد</span></label>
            <p class="muted small">تیمِ فعلی (${esc(num(s.totalMembers))} نفر) تغییر نمی‌کند؛ برای سرپرستِ غیرفعال یا تنزل‌یافته ابتدا تیم را منتقل کنید.</p>
            <div class="modal-actions"><button type="submit" class="btn primary" ${locked ? 'disabled' : ''}>ادامه</button>
            <button type="button" class="btn ghost" data-cancel>انصراف</button></div></form>`,
          onMount(body, h) {
            $('[data-cancel]', body).addEventListener('click', () => h.close());
            $('form', body).addEventListener('submit', async (e) => {
              e.preventDefault();
              const role = privileged ? s.role : $('[name=role]', body).value;
              const isActive = $('[name=active]', body).checked;
              const changes = {};
              if (role !== s.role) changes.role = role;
              if (isActive !== !!s.isActive) changes.isActive = isActive;
              if (!Object.keys(changes).length) { h.close(); return; }
              const parts = [];
              if (changes.role) parts.push(`نقش: ${ROLE_LABEL[s.role]} ← ${ROLE_LABEL[role]}`);
              if ('isActive' in changes) parts.push(`وضعیت: ${isActive ? 'فعال‌سازی' : 'غیرفعال‌سازی'}`);
              h.close();
              const reason = await AP.askReason({ title: 'تغییر نقش/وضعیت', message: `${s.fullName} — ${parts.join('؛ ')}. نشست‌های پنل این کاربر باطل می‌شود.`, confirmText: 'اعمال', placeholder: 'دلیل تغییر' });
              if (reason === null) return;
              try {
                await AP.api(`/admin/users/${s.id}`, { method: 'PATCH', body: { ...changes, reason } });
                toast('تغییر اعمال شد.');
                await load();
              } catch (err) { toast(err.message, true); }
            });
          },
        });
        return m;
      }

      // تعیین/حذف جانشین سرپرست (GET/PUT /admin/supervisors/:id/deputy)
      async function actDeputy(s) {
        const d = await AP.api(`/admin/supervisors/${s.id}/deputy`);
        const cur = d.deputy && d.deputy.id;
        const opts = d.candidates.map((c) => `<option value="${esc(c.id)}" ${cur === c.id ? 'selected' : ''}>${esc(c.fullName)}</option>`).join('');
        AP.modal({
          title: `جانشین «${s.fullName}»`,
          body: `<form class="form">
            <p class="muted small">جانشین فقط وقتی فعال می‌شود که سرپرست غیرفعال یا تمام‌روز در مرخصی/ماموریتِ تأییدشده باشد؛ آن‌وقت اعلان‌ها و صف تأیید (مرخصی/ماموریت، اجازه‌ی ورود) و تعیین تسک فوری برای تیم این سرپرست به جانشین هم می‌رسد. سرپرست و ادمین‌ها مثل قبل دسترسی دارند.</p>
            ${d.absent ? '<p class="muted small">این سرپرست امروز در دسترس نیست.</p>' : ''}
            <label class="field"><span>جانشین</span><select name="deputy"><option value="">— بدون جانشین —</option>${opts}</select></label>
            <div class="modal-actions"><button type="submit" class="btn primary">ادامه</button>
            <button type="button" class="btn ghost" data-cancel>انصراف</button></div></form>`,
          onMount(body, h) {
            $('[data-cancel]', body).addEventListener('click', () => h.close());
            $('form', body).addEventListener('submit', async (e) => {
              e.preventDefault();
              const v = $('[name=deputy]', body).value;
              const deputyId = v ? Number(v) : null;
              if (deputyId === (cur || null)) { h.close(); return; }
              h.close();
              const reason = await AP.askReason({ title: 'تغییر جانشین', message: `${s.fullName} — ${deputyId ? 'جانشین: ' + ((d.candidates.find((c) => c.id === deputyId) || {}).fullName || '') : 'حذف جانشین'}`, confirmText: 'اعمال', placeholder: 'دلیل تغییر' });
              if (reason === null) return;
              try {
                await AP.api(`/admin/supervisors/${s.id}/deputy`, { method: 'PUT', body: { deputyId, reason } });
                toast('جانشین ثبت شد.');
                await load();
              } catch (err) { toast(err.message, true); }
            });
          },
        });
      }

      // استثناهای یک سرپرست (GET/PUT/DELETE /admin/supervisors/:id/overrides[/:key])؛ اولویت: استثنا > تنظیم سراسری
      async function actOverrides(s) {
        const d = await AP.api(`/admin/supervisors/${s.id}/overrides`);
        const ctl = (it) => {
          if (it.type === 'boolean') {
            const v = it.hasOverride ? String(it.override) : '';
            return `<select name="v" aria-label="${esc(it.label)}"><option value="" ${v === '' ? 'selected' : ''}>بدون استثنا (سراسری)</option><option value="true" ${v === 'true' ? 'selected' : ''}>روشن</option><option value="false" ${v === 'false' ? 'selected' : ''}>خاموش</option></select>`;
          }
          return `<input type="number" name="v" min="${esc(it.min)}" max="${esc(it.max)}" step="1" inputmode="numeric" placeholder="بدون استثنا" value="${it.hasOverride ? esc(it.override) : ''}" aria-label="${esc(it.label)}" />`;
        };
        const m = AP.modal({
          title: `استثناهای «${s.fullName}»`, wide: true,
          body: `<p class="muted small">مقدارِ استثنا بر تنظیم سراسری اولویت دارد؛ خالی/«بدون استثنا» یعنی همان مقدار سراسری. هر تغییر با دلیل ثبت می‌شود.</p>
            <div class="table-wrap"><table data-stack><thead><tr><th>مورد</th><th>مقدار سراسری</th><th>استثنا</th><th></th></tr></thead><tbody>
            ${d.items.map((it) => `<tr data-key="${esc(it.key)}" data-type="${esc(it.type)}" data-had="${it.hasOverride ? '1' : ''}"><td data-label="مورد">${esc(it.label)}</td><td data-label="مقدار سراسری">${esc(it.type === 'boolean' ? boolLabel(it.global) : (it.global === null ? '—' : num(it.global)))}</td><td data-label="استثنا">${ctl(it)}</td><td><button type="button" class="btn primary small" data-save>ثبت</button></td></tr>`).join('')}
            </tbody></table></div><div class="form-msg" data-msg aria-live="polite"></div>`,
          onMount(body, h) {
            body.addEventListener('click', async (e) => {
              const btn = e.target.closest('[data-save]');
              if (!btn) return;
              const tr = btn.closest('[data-key]');
              const key = tr.dataset.key;
              const raw = $('[name=v]', tr).value;
              const msg = $('[data-msg]', body);
              msg.className = 'form-msg'; msg.textContent = '';
              let value;
              if (raw !== '') value = tr.dataset.type === 'boolean' ? raw === 'true' : Number(raw);
              if (raw === '' && !tr.dataset.had) return;
              const label = $('td', tr).textContent;
              h.close();
              const reason = await AP.askReason({ title: raw === '' ? 'حذف استثنا' : 'ثبت استثنا', message: `${s.fullName} — ${label}`, confirmText: raw === '' ? 'حذف' : 'ثبت', placeholder: 'دلیل تغییر' });
              if (reason === null) return;
              try {
                if (raw === '') await AP.api(`/admin/supervisors/${s.id}/overrides/${key}`, { method: 'DELETE', body: { reason } });
                else await AP.api(`/admin/supervisors/${s.id}/overrides/${key}`, { method: 'PUT', body: { value, reason } });
                toast(raw === '' ? 'استثنا حذف شد.' : 'استثنا ثبت شد.');
              } catch (err) { toast(err.message, true); }
            });
          },
        });
        return m;
      }

      async function actUnassigned() {
        const users = await usersWithSup((u) => !u.managerId && u.isActive !== false && !['manager', 'admin', 'owner'].includes(u.role));
        const ids = await pickUsers({ title: 'کارمندان بدون سرپرست', users, hint: 'کارمندان انتخاب‌شده را به یک سرپرست تخصیص دهید.', confirmText: 'انتخاب سرپرست' });
        if (!ids) return;
        const t = await chooseTarget({ title: 'تخصیص به سرپرست', supervisors: data.supervisors, excludeId: null, allowNone: false });
        if (!t || !t.to) return;
        await doMove({ path: `/admin/supervisors/${t.to}/members`, bodyBase: { userIds: ids }, verb: 'به تیم اضافه', title: 'تخصیص سرپرست', confirmText: 'تخصیص', doneMsg: 'تخصیص انجام شد' });
      }

      root.addEventListener('click', async (e) => {
        const refresh = e.target.closest('[data-sup-refresh]');
        if (refresh) { await load(); return; }
        if (e.target.closest('[data-act-un]')) { try { await actUnassigned(); } catch (err) { toast(err.message, true); } return; }
        const btn = e.target.closest('[data-act]');
        if (!btn) return;
        const tr = btn.closest('[data-sup]');
        const s = tr && supById(Number(tr.dataset.sup));
        if (!s) return;
        try {
          if (btn.dataset.act === 'view') await actView(s);
          else if (btn.dataset.act === 'add') await actAdd(s);
          else if (btn.dataset.act === 'transfer') await actTransfer(s);
          else if (btn.dataset.act === 'role') actRole(s);
          else if (btn.dataset.act === 'deputy') await actDeputy(s);
          else if (btn.dataset.act === 'overrides') await actOverrides(s);
        } catch (err) { toast(err.message, true); }
      });

      load();
    },
  };
}());
