// پنجره‌ی چتِ «تحلیلگر هوشمند» (فقط کسی که مجوز ai.assistant دارد). همه‌ی متن‌ها با textContent ساخته می‌شوند (بدون innerHTML) تا
// حتی اگر مدل/داده چیزی شبیه HTML برگرداند اجرا نشود. استایل‌ها در css/polish/39-ai-assistant.css (CSP: بدون style درون‌خطی).
(function () {
  'use strict';
  const AP = window.AP;
  if (!AP) return;

  const SUGGESTIONS = [
    'گزارش عملکرد کل تیم در ۳۰ روز اخیر',
    'چه کسانی بیشترین تأخیر را این ماه داشتند و روندشان چیست؟',
    'الگوهای رفتاری قابل‌توجه این ماه را بررسی کن',
    'مرخصی‌ها و اعتراض‌های منتظر تصمیم را فهرست کن',
  ];
  const CHIP_ICONS = ['📊', '⏱', '🔎', '📥', '📤'];
  const TOOL_LABELS = {
    list_employees: 'فهرست کارمندان', team_performance: 'عملکرد تیم', employee_performance: 'عملکرد کارمند', employee_day: 'بازرسی روز',
    late_trend: 'روند تأخیر', late_compare: 'مقایسه‌ی تأخیر', rankings: 'رتبه‌بندی', attendance_rate: 'نرخ حضور', leave_by_type: 'مرخصی',
    checkin_distribution: 'توزیع ساعت ورود', behavior_patterns: 'الگوهای رفتاری',
    propose_leave_decision: 'پیشنهاد تصمیم مرخصی', propose_dispute_reply: 'پیشنهاد پاسخ اعتراض', propose_dispute_close: 'پیشنهاد بستن اعتراض', compare_periods: 'مقایسه‌ی دوره‌ها', export_excel: 'خروجی اکسل', remember_note: 'ذخیره‌ی یادداشت', forget_note: 'یادداشت‌ها',
    attendance_log: 'ریز تردد', remote_work: 'دورکاری', tasks_overview: 'تسک‌ها', leave_requests: 'درخواست‌های مرخصی', disputes: 'اعتراض‌ها', overtime_decisions: 'اضافه‌کاری', shifts_holidays: 'شیفت و تعطیلات', payroll_summary: 'حقوق', org_overview: 'ساختار سازمان', panel_settings: 'تنظیمات پنل', audit_trail: 'ممیزی', system_status: 'وضعیت سیستم', checkin_permissions: 'اجازه‌ی ورود', suspicious_events: 'رویدادهای مشکوک', panel_guide: 'راهنمای پنل',
  };

  // کارت عملیات پیشنهادیِ ایجنت: فقط با کلیک صریح مدیر اجرا می‌شود
  function actionCard(p) {
    const card = el('div', 'ai-action');
    card.appendChild(el('div', 'ai-action-text', p.summary));
    const status = el('div', 'ai-action-status', 'منتظر تأیید شما (۱۵ دقیقه)');
    const ok = el('button', 'btn ai-action-ok', 'تأیید و اجرا');
    const no = el('button', 'btn ghost ai-action-no', 'لغو');
    ok.type = 'button'; no.type = 'button';
    const done = (msg, isErr) => { ok.remove(); no.remove(); status.textContent = msg; status.classList.toggle('ai-error', !!isErr); };
    const call = async (verb) => {
      ok.disabled = true; no.disabled = true;
      try {
        const r = await AP.api('/admin/ai/actions/' + p.id + '/' + verb, { method: 'POST', body: {} });
        done((verb === 'confirm' ? '✅ ' : '✖ ') + r.message);
      } catch (err) { done('⚠️ ' + (err.message || 'خطا'), true); }
    };
    ok.addEventListener('click', () => call('confirm'));
    no.addEventListener('click', () => call('cancel'));
    card.append(status, ok, no);
    return card;
  }

  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  };

  // **درشت** و `کد` داخل یک خط
  function inline(parent, text) {
    const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
    let last = 0; let m;
    while ((m = re.exec(text))) {
      if (m.index > last) parent.appendChild(document.createTextNode(text.slice(last, m.index)));
      const tok = m[0];
      parent.appendChild(el(tok[0] === '*' ? 'strong' : 'code', '', tok.slice(tok[0] === '*' ? 2 : 1, tok[0] === '*' ? -2 : -1)));
      last = m.index + tok.length;
    }
    if (last < text.length) parent.appendChild(document.createTextNode(text.slice(last)));
  }

  const isRow = (l) => /^\s*\|.*\|\s*$/.test(l);
  const isSep = (l) => /^\s*\|[\s:|-]+\|\s*$/.test(l);
  const cells = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());

  // Markdown ساده: تیتر، فهرست (• و عددی)، جدول، پاراگراف
  function render(container, md) {
    const lines = String(md).replace(/\r/g, '').split('\n');
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (!line.trim()) { i += 1; continue; }
      const h = /^(#{1,4})\s+(.*)$/.exec(line);
      if (h) { const n = el('h' + Math.min(h[1].length + 2, 6), 'ai-h'); inline(n, h[2]); container.appendChild(n); i += 1; continue; }
      if (isRow(line) && i + 1 < lines.length && isSep(lines[i + 1])) {
        const wrap = el('div', 'ai-table-wrap'); const t = el('table', 'ai-table');
        const thead = el('thead'); const hr = el('tr');
        cells(line).forEach((c) => { const th = el('th'); inline(th, c); hr.appendChild(th); });
        thead.appendChild(hr); t.appendChild(thead);
        const tb = el('tbody'); i += 2;
        while (i < lines.length && isRow(lines[i])) {
          const tr = el('tr'); cells(lines[i]).forEach((c) => { const td = el('td'); inline(td, c); tr.appendChild(td); }); tb.appendChild(tr); i += 1;
        }
        t.appendChild(tb); wrap.appendChild(t); container.appendChild(wrap); continue;
      }
      if (/^\s*>\s?/.test(line)) {
        const q = el('div', 'ai-quote'); const buf = [];
        while (i < lines.length && /^\s*>\s?/.test(lines[i])) { buf.push(lines[i].replace(/^\s*>\s?/, '').trim()); i += 1; }
        const qp = el('p'); inline(qp, buf.join(' ')); q.appendChild(qp); container.appendChild(q); continue;
      }
      const li = /^\s*([-*•]|\d+[.)])\s+(.*)$/.exec(line);
      if (li) {
        const ordered = /\d/.test(li[1]); const list = el(ordered ? 'ol' : 'ul', 'ai-list');
        while (i < lines.length) {
          const m = /^\s*([-*•]|\d+[.)])\s+(.*)$/.exec(lines[i]);
          if (!m) break;
          const item = el('li'); inline(item, m[2]); list.appendChild(item); i += 1;
        }
        container.appendChild(list); continue;
      }
      const p = el('p'); const buf = [];
      while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|\s*([-*•]|\d+[.)])\s|\s*\||\s*>)/.test(lines[i])) { buf.push(lines[i].trim()); i += 1; }
      if (!buf.length) { buf.push(line.trim()); i += 1; }
      inline(p, buf.join(' ')); container.appendChild(p);
    }
  }

  AP.initAiAssistant = function initAiAssistant() {
    if (document.getElementById('ai-fab') || !AP.can('ai.assistant')) return;
    const history = [];
    let busy = false;

    const fab = el('button', 'ai-fab', '✦ تحلیلگر هوشمند');
    fab.id = 'ai-fab'; fab.type = 'button'; fab.setAttribute('aria-expanded', 'false'); fab.setAttribute('aria-controls', 'ai-panel');

    const panel = el('section', 'ai-panel hidden');
    panel.id = 'ai-panel'; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'تحلیلگر هوشمند');
    const head = el('header', 'ai-head');
    const title = el('div', 'ai-title');
    title.append(el('strong', '', 'تحلیلگر هوشمند'), el('span', 'ai-sub', 'آنلاین · فقط‌خواندنی، اقدام‌ها با تأیید شما'));
    head.appendChild(title);
    const clear = el('button', 'ai-link', 'گفتگوی تازه'); clear.type = 'button';
    const close = el('button', 'ai-link', 'بستن'); close.type = 'button';
    head.append(clear, close);
    const log = el('div', 'ai-log'); log.setAttribute('role', 'log'); log.setAttribute('aria-live', 'polite');
    const chips = el('div', 'ai-chips');
    const form = el('form', 'ai-form');
    const input = el('textarea', 'ai-input'); input.rows = 2; input.maxLength = 2000; input.placeholder = 'مثلاً: گزارش عملکرد «نام کارمند» در ۳۰ روز اخیر را تحلیل کن'; input.setAttribute('aria-label', 'پرسش');
    const send = el('button', 'btn primary ai-send', 'ارسال'); send.type = 'submit';
    form.append(input, send);
    panel.append(head, log, chips, form);
    document.body.append(fab, panel);

    const note = el('p', 'ai-note', 'تحلیل خودکار بر پایه‌ی همان داده‌ی نمودارهای پنل است و نیاز به بررسی مدیر دارد. حقوق و نرخ ساعتی به ایجنت داده نمی‌شود.');
    const hero = el('div', 'ai-hero');
    hero.append(el('div', 'ai-hero-icon', '✦'), el('div', 'ai-hero-title', 'سلام! چه کمکی از من برمیاد؟'),
      el('div', 'ai-hero-text', 'درباره‌ی تردد، تأخیر، مرخصی، اعتراض‌ها و تسک‌ها بپرسید؛ یا بگویید کدام بخش پنل کجاست.'));
    log.append(hero, note);

    function bubble(role, text) {
      const b = el('div', 'ai-msg ai-' + role);
      if (role === 'assistant') {
        render(b, text);
        if (text) {
          const cp = el('button', 'ai-copy', 'کپی'); cp.type = 'button'; cp.setAttribute('aria-label', 'کپی پاسخ');
          cp.addEventListener('click', async () => {
            try { await navigator.clipboard.writeText(text); cp.textContent = 'کپی شد ✓'; } catch (_) { cp.textContent = 'ناموفق'; }
            setTimeout(() => { cp.textContent = 'کپی'; }, 1600);
          });
          b.appendChild(cp);
        }
      } else b.textContent = text;
      hero.classList.add('hidden');
      log.appendChild(b); log.scrollTop = log.scrollHeight;
      return b;
    }

    SUGGESTIONS.forEach((s) => {
      const c = el('button', 'ai-chip'); c.type = 'button';
      c.append(el('span', 'ai-chip-ico', CHIP_ICONS[chips.childElementCount % CHIP_ICONS.length]), el('span', 'ai-chip-txt', s));
      c.addEventListener('click', () => { input.value = s; form.requestSubmit(); });
      chips.appendChild(c);
    });

    function setOpen(open) {
      panel.classList.toggle('hidden', !open);
      fab.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open) input.focus(); else fab.focus();
    }
    fab.addEventListener('click', () => setOpen(panel.classList.contains('hidden')));
    close.addEventListener('click', () => setOpen(false));
    panel.addEventListener('keydown', (e) => { if (e.key === 'Escape') setOpen(false); });
    clear.addEventListener('click', () => { if (busy) return; history.length = 0; log.textContent = ''; log.append(hero, note); chips.classList.remove('hidden'); hero.classList.remove('hidden'); });
    input.addEventListener('input', () => { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 120) + 'px'; });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); } });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text || busy) return;
      busy = true; send.disabled = true; input.value = ''; chips.classList.add('hidden');
      history.push({ role: 'user', content: text });
      bubble('user', text);
      const wait = bubble('assistant', '');
      wait.classList.add('ai-wait'); wait.textContent = 'در حال خواندن داده‌ها و تحلیل… (ممکن است تا یک دقیقه طول بکشد)';
      try {
        const r = await AP.api('/admin/ai/chat', { method: 'POST', body: { messages: history } });
        history.push({ role: 'assistant', content: r.reply });
        wait.remove();
        const b = bubble('assistant', r.reply);
        const names = [...new Set((r.tools || []).map((t) => TOOL_LABELS[t.name] || t.name))];
        if (names.length) {
          const used = el('div', 'ai-used', 'داده‌های خوانده‌شده:');
          names.forEach((n) => used.appendChild(el('span', 'ai-tag', n)));
          b.appendChild(used);
        }
        (r.pending || []).forEach((p) => b.appendChild(actionCard(p)));
        (r.files || []).forEach((f) => {
          const a = el('a', 'ai-file', '⬇️ دانلود ' + f.name);
          a.href = '/api/admin/ai/export/' + encodeURIComponent(f.token);
          a.setAttribute('download', f.name);
          b.appendChild(a);
        });
        log.scrollTop += b.getBoundingClientRect().top - log.getBoundingClientRect().top - 12;
      } catch (err) {
        history.pop();
        wait.remove();
        bubble('assistant', '⚠️ ' + (err.message || 'خطا در ارتباط با ایجنت')).classList.add('ai-error');
      } finally { busy = false; send.disabled = false; input.focus(); }
    });
  };
})();
