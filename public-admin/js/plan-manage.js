// E3 (فاز ۱۳): اقدام‌های مدیریتی روی دفترچه‌ی «برنامه هفته بعد» که به قفل ویرایش تسک‌ها وابسته نیستند:
//   ۱) «ویرایش ساعت کاری این روز» (schedule.manage) ← همان مودال B2 (AP.scheduleTab.editModal؛ قواعد و قفل ماه بسته سمت سرور)،
//   ۲) «⚡ تسک فوری» (tasks.assign_urgent) ← همان فرم فاز ۱۲ (AP.openUrgentTaskForm) با تاریخ همان روز؛ در هفته‌ی شروع‌شده هم مجاز است،
//   ۳) «یادداشت سرپرست» (reviews.write) ← PUT /admin/users/:id/plan/supervisor-comment.
// بعد از هر موفقیت، مدل هفته از سرور دوباره خوانده می‌شود (ساعت مؤثر، خلاصه‌ی هفته و هشدارها تازه می‌شوند).
// شمارنده‌ی «تغییر اطلاع‌داده‌نشده»ی E1 را عوض نمی‌کنند: تسک فوری و ساعت روز اعلان مستقل خودشان را دارند و یادداشت از جنس تغییر تسک نیست
// (شمارنده فقط از audit ویرایش تسک‌ها با plan.edit_team ساخته می‌شود) ⇒ دوباره‌اعلانی رخ نمی‌دهد.
// نمایش دکمه‌ها با AP.can فقط راهنمای UI است؛ گیت واقعی (مجوز/اسکوپ/ماه بسته/اعتبارسنجی) سمت سرور است.
(function () {
  'use strict';
  const AP = (window.AP = window.AP || {});

  /** @param {object} o { userId, userName, getModel(), applyModel(model), fetchModel(): Promise<model> } */
  function create({ userId, userName, getModel, applyModel, fetchModel }) {
    const isSelf = () => !!(AP.state && AP.state.me && AP.state.me.id === userId);

    async function reload() {
      try { applyModel(await fetchModel()); } catch (err) { AP.toast(err.message, true); }
    }

    async function openHours(day) {
      try {
        const sr = await AP.api(`/admin/users/${userId}/schedule?from=${encodeURIComponent(day.date)}&to=${encodeURIComponent(day.date)}`);
        const d = (sr.days || [])[0];
        if (!d) { AP.toast('اطلاعات این روز یافت نشد.', true); return; }
        AP.scheduleTab.editModal({ id: userId, fullName: userName }, d, reload);
      } catch (err) { AP.toast(err.message, true); }
    }

    // خطا را به فرم یادداشت پرتاب می‌کند (فرم باز می‌ماند)؛ موفقیت ⇒ دفترچه با مدل تازه دوباره ساخته می‌شود.
    async function saveComment(text) {
      const model = getModel();
      const res = await AP.api(`/admin/users/${userId}/plan/supervisor-comment`, { method: 'PUT', body: { weekStart: model.weekStart, comment: text } });
      applyModel(res);
      AP.toast(res.changed === false ? 'تغییری برای ذخیره نبود.' : (String(text).trim() ? 'یادداشت ذخیره شد.' : 'یادداشت پاک شد.'));
    }

    return {
      /** opts.manage برای renderWeek؛ بدون هیچ مجوزی ⇒ null */
      options() {
        const o = {};
        if (AP.can('schedule.manage') && AP.scheduleTab && AP.scheduleTab.editModal) o.onHours = openHours;
        if (AP.can('tasks.assign_urgent') && !isSelf() && typeof AP.openUrgentTaskForm === 'function') {
          o.onUrgent = (day) => AP.openUrgentTaskForm(userId, userName, reload, day.date);
        }
        if (AP.can('reviews.write') && !isSelf()) o.comment = { onSave: saveComment };
        return Object.keys(o).length ? o : null;
      },
      reload, openHours, saveComment,
    };
  }

  AP.planManage = { create };
})();
