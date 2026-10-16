// داده‌ی ثابت برای صفحه‌ی نمایشی nb-demo.html (فقط توسعه؛ هیچ API ای صدا زده نمی‌شود).
(function () {
  'use strict';
  const nb = window.AP.notebook;
  const dayCard = (title, tone, tapeLabel, chips, tasks) => nb.card({ title, tape: { tone, label: tapeLabel } },
    nb.h('div', {}, ...chips),
    nb.lines(tasks.map((t) => nb.h('span', { text: t })), { emptyText: 'تسکی ثبت نشده' }));

  const right = nb.page({ title: 'هفته‌ی ۵ تا ۱۱ مهر' },
    dayCard('شنبه ۵ مهر', 'sage', '✔ روز کاری', [nb.chip('۱۵:۳۰ تا ۲۱:۰۰', { tone: 'work', icon: '🕒' })], ['گزارش فروش', 'پیگیری سفارش‌ها']),
    dayCard('یکشنبه ۶ مهر', 'sand', '☾ آف', [nb.chip('آف', { tone: 'off' })], []),
    dayCard('دوشنبه ۷ مهر', 'rose', '🎉 تعطیل', [nb.chip('تعطیل رسمی', { tone: 'holiday' }), nb.chip('تسک روی روز تعطیل', { tone: 'warn', icon: '⚠' })], ['بررسی انبار']),
    dayCard('سه‌شنبه ۸ مهر', 'sky', '🌴 مرخصی', [nb.chip('مرخصی', { tone: 'leave' })], []));

  const left = nb.page({ title: 'ادامه‌ی هفته' },
    dayCard('چهارشنبه ۹ مهر', 'sage', '✔ روز کاری', [nb.chip('۱۵:۳۰ تا ۲۱:۰۰', { tone: 'work' }), nb.chip('⚡ فوری', { tone: 'urgent' }), nb.chip('🔒 از طرف سرپرست', { tone: 'locked' })], ['ارسال گزارش به مشتری', 'جلسه‌ی هماهنگی']),
    nb.card({ title: 'خلاصه‌ی هفته', tape: { tone: 'lilac', label: '📋 خلاصه' } },
      nb.lines([nb.h('span', { text: '۳ روز کاری' }), nb.h('span', { text: '۱۶٫۵ ساعت برنامه‌ریزی‌شده' }), nb.h('span', { text: '۶ تسک' })])),
    nb.card({ title: 'یادداشت سرپرست', tape: { tone: 'rose', label: '✎ یادداشت' } },
      nb.h('p', { text: 'لطفاً قبل از پایان هفته گزارش فروش را نهایی کنید.' }),
      nb.btn('ویرایش یادداشت', { variant: 'ghost' })),
    nb.card({ title: 'اقدام', tape: { tone: 'sky', label: 'دکمه‌ها' } },
      nb.btn('📣 اطلاع به کارمند'), ' ', nb.btn('غیرفعال', { disabled: true })));

  const host = document.getElementById('demo');
  host.appendChild(nb.root(nb.spread([right, left], { label: 'نمونه‌ی دفترچه‌ی هفته' })));
})();
