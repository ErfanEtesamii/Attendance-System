// صفحه‌ی «شیفت‌ها» (S3-9e): لیست، افزودن/ویرایش/حذف شیفت با API موجود S3-6a (همه با دلیل اجباری و audit سمت سرور).
// انتساب شیفت به کارمند در «پرونده‌ی کارمند ← اطلاعات و ویرایش» است (AP.shiftAssignCard در views-main.js).

(function () {
  'use strict';
  const AP = window.AP;
  const { $, $$, esc, fmt } = AP;
  const icon = (n) => AP.icon(n);

  // ۰=یکشنبه … ۶=شنبه (همان قرارداد API)؛ ترتیب نمایش از شنبه تا جمعه
  const DAY_ORDER = [6, 0, 1, 2, 3, 4, 5];
  const DAY_NAME = { 6: 'شنبه', 0: 'یکشنبه', 1: 'دوشنبه', 2: 'سه‌شنبه', 3: 'چهارشنبه', 4: 'پنجشنبه', 5: 'جمعه' };
  const DEFAULT_SHIFT = { name: '', startTime: '08:00', endTime: '16:30', overnight: false, graceLateMinutes: 0, graceEarlyMinutes: 0, maxLunchMinutes: 0, fixedLunchDeductMinutes: 0, workDays: [6, 0, 1, 2, 3] };

  const daysText = (days) => {
    const list = DAY_ORDER.filter((d) => (days || []).includes(d));
    return list.length ? list.map((d) => DAY_NAME[d]).join('، ') : '—';
  };

  // ورودی فرم ⇒ بدنه‌ی API (عددها Number، روزها آرایه)
  function formToBody(form) {
    const f = AP.formData(form);
    const num = (v) => (v === '' || v == null ? 0 : Number(v));
    return {
      name: f.name,
      startTime: f.startTime,
      endTime: f.endTime,
      overnight: !!f.overnight,
      graceLateMinutes: num(f.graceLateMinutes),
      graceEarlyMinutes: num(f.graceEarlyMinutes),
      maxLunchMinutes: num(f.maxLunchMinutes),
      fixedLunchDeductMinutes: num(f.fixedLunchDeductMinutes),
      workDays: $$('input[name="workDays"]', form).filter((el) => el.checked).map((el) => Number(el.value)),
    };
  }

  function formHtml(cur, isEdit) {
    const numField = (name, label, max) => `<label class="field"><span>${esc(label)}</span><input type="number" name="${name}" min="0" max="${max}" step="1" value="${esc(cur[name])}" /></label>`;
    return `<form class="form" id="shift-form">
      <div class="form-grid">
        <label class="field"><span>نام شیفت</span><input name="name" required maxlength="60" value="${esc(cur.name)}" placeholder="مثلاً: صبح" /></label>
        <label class="field"><span>ساعت شروع</span><input type="time" name="startTime" required value="${esc(cur.startTime)}" /></label>
        <label class="field"><span>ساعت پایان</span><input type="time" name="endTime" required value="${esc(cur.endTime)}" /></label>
        <label class="check-row full" style="grid-column:1/-1"><input type="checkbox" name="overnight"${cur.overnight ? ' checked' : ''} /> شیفت شب است (پایان بعد از نیمه‌شب، مثلاً ۲۲:۰۰ تا ۰۶:۰۰)</label>
        ${numField('graceLateMinutes', 'مهلت تأخیر (دقیقه)', 720)}
        ${numField('graceEarlyMinutes', 'مهلت زودتر رفتن (دقیقه)', 720)}
        ${numField('maxLunchMinutes', 'حداکثر ناهار مجاز (دقیقه؛ ۰ = بدون سقف)', 480)}
        ${numField('fixedLunchDeductMinutes', 'کسر ثابت ناهار (دقیقه؛ ۰ = خاموش)', 480)}
        <div class="field full" style="grid-column:1/-1"><span>روزهای کاری این شیفت</span>
          <div class="chk-row">${DAY_ORDER.map((d) => `<label class="check-row"><input type="checkbox" name="workDays" value="${d}"${(cur.workDays || []).includes(d) ? ' checked' : ''} /> ${DAY_NAME[d]}</label>`).join('')}</div></div>
      </div>
      <div class="form-msg err"></div>
      <div class="modal-actions"><button class="btn primary" type="submit">${isEdit ? 'ذخیره‌ی تغییرات' : 'افزودن شیفت'}</button><button class="btn ghost" type="button" data-cancel>انصراف</button></div>
    </form>`;
  }

  AP.view('shifts', {
    admin: true,
    nav: { icon: 'clock', label: 'شیفت‌ها', group: 'مدیریت', admin: true },
    async render() {
      const shifts = await AP.api('/admin/shifts');
      const html = `
        <div class="view-header"><div><h2>شیفت‌ها</h2>
          <div class="sub">کارمندِ بدون شیفت با ساعات پیش‌فرض «تنظیمات» محاسبه می‌شود · ${fmt.num(shifts.length)} شیفت تعریف‌شده</div></div>
          <div class="header-actions"><button class="btn primary" id="shift-add">${icon('plus')} افزودن شیفت</button></div></div>
        <div class="card flush">${shifts.length ? `<div class="table-wrap"><table><thead><tr>
          <th>نام</th><th>ساعت کار</th><th>روزهای کاری</th><th>مهلت تأخیر / زودتر رفتن</th><th>ناهار</th><th>کارمندان</th><th></th></tr></thead><tbody>
          ${shifts.map((s) => `<tr data-id="${s.id}">
            <td><b>${esc(s.name)}</b></td>
            <td><span class="ltr">${esc(s.startTime)} – ${esc(s.endTime)}</span>${s.overnight ? ` ${AP.badge('purple', 'شب')}` : ''}</td>
            <td>${esc(daysText(s.workDays))}</td>
            <td>${fmt.num(s.graceLateMinutes)} / ${fmt.num(s.graceEarlyMinutes)} دقیقه</td>
            <td>${s.maxLunchMinutes ? `حداکثر ${fmt.num(s.maxLunchMinutes)}` : 'بدون سقف'}${s.fixedLunchDeductMinutes ? ` · کسر ثابت ${fmt.num(s.fixedLunchDeductMinutes)}` : ''}</td>
            <td>${s.userCount ? `<button class="btn ghost small" data-users="${s.id}">${fmt.num(s.userCount)} نفر</button>` : '<span class="muted">—</span>'}</td>
            <td><div class="row-actions"><button class="btn ghost small" data-edit="${s.id}" aria-label="ویرایش">${icon('edit')}</button>
              <button class="btn danger small" data-del="${s.id}" aria-label="حذف">${icon('trash')}</button></div></td></tr>`).join('')}
          </tbody></table></div>`
          : `<div class="empty">${AP.icon('inbox')}هنوز شیفتی تعریف نشده است؛ همه‌ی کارمندان با ساعات پیش‌فرض تنظیمات محاسبه می‌شوند.</div>`}</div>`;

      function openForm(s) {
        const cur = s || DEFAULT_SHIFT;
        AP.modal({
          title: s ? `ویرایش شیفت «${s.name}»` : 'افزودن شیفت',
          wide: true,
          body: formHtml(cur, !!s),
          onMount(body, m) {
            const form = $('#shift-form', body);
            $('[data-cancel]', form).addEventListener('click', () => m.close());
            form.addEventListener('submit', async (e) => {
              e.preventDefault();
              const msg = $('.form-msg', form);
              msg.textContent = '';
              const reason = await AP.askReason({
                title: s ? 'دلیل ویرایش شیفت' : 'دلیل افزودن شیفت', confirmText: 'ثبت',
                message: s ? 'تغییر شیفت روی محاسبه‌ی روزهای بعد و گزارش‌هایی که دوباره محاسبه شوند اثر دارد.' : '',
              });
              if (reason === null) return;
              try {
                const r = await AP.api(s ? `/admin/shifts/${s.id}` : '/admin/shifts', { method: s ? 'PATCH' : 'POST', body: { ...formToBody(form), reason } });
                AP.toast(s ? (r.changed === false ? 'تغییری وجود نداشت.' : 'شیفت ذخیره شد.') : 'شیفت اضافه شد.');
                m.close();
                AP.refresh();
              } catch (err) { msg.textContent = err.message; }
            });
          },
        });
      }

      async function openUsers(s) {
        const d = await AP.api(`/admin/shifts/${s.id}`);
        AP.modal({
          title: `کارمندان شیفت «${s.name}»`,
          body: d.users.length
            ? `<div class="list">${d.users.map((u) => `<a class="item" href="#/profile/${u.id}" style="color:inherit;text-decoration:none">${AP.avatar(u.fullName, 'sm')}
                <div class="grow"><div class="title">${esc(u.fullName)}</div><div class="meta">${esc(u.department || '—')}</div></div></a>`).join('')}</div>
              <p class="muted small" style="margin:12px 0 0">برای تغییر یا برداشتن شیفت، پرونده‌ی کارمند ← «اطلاعات و ویرایش».</p>`
            : '<div class="empty">کارمندی در محدوده‌ی دسترسی شما به این شیفت منتسب نیست.</div>',
        });
      }

      return {
        html,
        mount(page) {
          const byId = new Map(shifts.map((s) => [s.id, s]));
          $('#shift-add', page).addEventListener('click', () => openForm(null));
          $$('[data-edit]', page).forEach((b) => b.addEventListener('click', () => openForm(byId.get(Number(b.dataset.edit)))));
          $$('[data-users]', page).forEach((b) => b.addEventListener('click', () => AP.attempt(() => openUsers(byId.get(Number(b.dataset.users))))));
          $$('[data-del]', page).forEach((b) => b.addEventListener('click', async () => {
            const s = byId.get(Number(b.dataset.del));
            const reason = await AP.askReason({
              title: `حذف شیفت «${s.name}»`, danger: true, confirmText: 'حذف شیفت',
              message: s.userCount ? `این شیفت به ${fmt.num(s.userCount)} کارمند منتسب است و حذف نمی‌شود؛ ابتدا انتساب‌ها را بردارید.` : 'شیفت برای همیشه حذف می‌شود (در گزارش رویدادها ثبت می‌شود).',
            });
            if (reason === null) return;
            const ok = await AP.attempt(() => AP.api(`/admin/shifts/${s.id}`, { method: 'DELETE', body: { reason } }), 'شیفت حذف شد.');
            if (ok) AP.refresh();
          }));
        },
      };
    },
  });

  // کارت «شیفت کاری» برای پرونده‌ی کارمند (فقط ادمین کل). ورودی: کارمند (با shiftId) و فهرست شیفت‌ها.
  AP.shiftAssignCard = function shiftAssignCard(u, shifts) {
    const cur = u.shiftId == null ? '' : String(u.shiftId);
    return `<div class="card" id="shift-card" style="margin-top:14px"><form class="form" id="shift-assign-form">
      <label class="field"><span>شیفت کاری</span><select name="shiftId">
        <option value=""${cur === '' ? ' selected' : ''}>— بدون شیفت (ساعات پیش‌فرض تنظیمات) —</option>
        ${shifts.map((s) => `<option value="${s.id}"${String(s.id) === cur ? ' selected' : ''}>${esc(s.name)} (${esc(s.startTime)}–${esc(s.endTime)}${s.overnight ? '، شب' : ''})</option>`).join('')}
      </select></label>
      ${shifts.length ? '' : '<p class="muted small" style="margin:0">هنوز شیفتی تعریف نشده است (منوی «شیفت‌ها»).</p>'}
      <div class="form-msg"></div>
      <div class="modal-actions"><button class="btn primary" type="submit"${shifts.length ? '' : ' disabled'}>ذخیره‌ی شیفت</button></div>
    </form></div>`;
  };

  AP.bindShiftAssign = function bindShiftAssign(root, u) {
    const form = $('#shift-assign-form', root);
    if (!form) return;
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const raw = form.shiftId.value;
      const before = u.shiftId == null ? '' : String(u.shiftId);
      if (raw === before) { AP.toast('شیفت تغییری نکرده است.'); return; }
      const reason = await AP.askReason({ title: `تغییر شیفت «${u.fullName}»`, confirmText: 'ثبت' });
      if (reason === null) return;
      const ok = await AP.attempt(() => AP.api(`/admin/users/${u.id}/shift`, { method: 'PUT', body: { shiftId: raw === '' ? null : Number(raw), reason } }), 'شیفت کارمند ذخیره شد.');
      if (ok) AP.refresh();
    });
  };
})();
