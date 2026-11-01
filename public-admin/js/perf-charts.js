// نمودارهای SVG صفحه‌ی «عملکرد»: خطی چندشاخصه (روزانه/تجمعی + هم‌پوشانیِ دوره‌ی قبل)، ساعت ورود/خروج، میله‌ایِ حقوق، ساعت‌به‌ساعت.
// DOM با createElementNS ساخته می‌شود (بدون innerHTML برای SVG)؛ متن‌های تولتیپ همه escape می‌شوند. رنگ‌ها فقط با کلاس CSS (CSP).
// تزریق: PerfCharts.init({ esc, fa, fmt, shortDate }) از views-performance.js.
(function (root) {
  'use strict';
  const SVG = 'http://www.w3.org/2000/svg';
  let D = { esc: (v) => String(v), fa: (v) => String(v), fmt: { min: (v) => String(v), num: (v) => String(v) }, shortDate: (v) => v };
  const W = 900; const H = 300; const L = 56; const R = 16; const T = 16; const B = 34;

  function init(deps) { D = Object.assign(D, deps); }
  const el = (name, attrs = {}, text) => { const n = document.createElementNS(SVG, name); Object.keys(attrs).forEach((k) => n.setAttribute(k, String(attrs[k]))); if (text != null) n.textContent = text; return n; };
  const wrap = (host) => { host.textContent = ''; const tip = document.createElement('div'); tip.className = 'pf-tip'; tip.hidden = true; return tip; };
  const emptyMsg = (host, msg) => { host.innerHTML = `<div class="empty">${D.esc(msg)}</div>`; };

  function niceMax(v) {
    if (!(v > 0)) return 1;
    const pow = 10 ** Math.floor(Math.log10(v)); const f = v / pow;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * pow;
  }
  const clock = (m) => { if (m == null) return '—'; const a = Math.round(m); return `${D.fa(String(Math.floor(a / 60) % 24).padStart(2, '0'))}:${D.fa(String(a % 60).padStart(2, '0'))}`; };
  const metricText = (m, v) => (m.kind === 'min' ? D.fmt.min(v) : m.kind === 'money' ? `${D.fmt.num(v)} تومان` : D.fmt.num(v));

  function placeTip(tip, svg, xUnits) {
    const box = svg.getBoundingClientRect();
    tip.style.left = `${Math.min(Math.max((xUnits / W) * box.width, 95), box.width - 95)}px`;
  }

  function grid(svg, lines) {
    for (let i = 0; i <= lines; i += 1) svg.appendChild(el('line', { x1: L, x2: W - R, y1: T + (i * (H - T - B)) / lines, y2: T + (i * (H - T - B)) / lines, class: 'pf-grid' }));
  }

  // ---------- خطی چندشاخصه ----------
  // o: { rows, prev, metrics:[{key,label,kind}], mode:'daily'|'cum', statusLabel(r), extraTip(r,i) }
  function lineChart(host, o) {
    const tip = wrap(host);
    const rows = o.rows || [];
    if (!rows.length || !o.metrics.length) { emptyMsg(host, 'داده‌ای در این بازه نیست.'); return ''; }
    const cum = o.mode === 'cum';
    const n = rows.length;
    const series = (list, key) => { let run = 0; return list.map((r) => { const v = r[key] || 0; if (cum) { run += v; return run; } return v; }); };
    const data = o.metrics.map((m) => ({ m, cur: series(rows, m.key), prev: o.prev && o.prev.length ? series(o.prev, m.key) : null }));
    const allMin = o.metrics.every((m) => m.kind === 'min');
    const sharedMax = niceMax(Math.max(0, ...data.flatMap((s, i) => s.cur.concat(i === 0 && s.prev ? s.prev : []))));
    const maxOf = (s, i) => (allMin ? sharedMax : niceMax(Math.max(0, ...s.cur, ...(i === 0 && s.prev ? s.prev : []))));
    const xAt = (i) => (n === 1 ? (L + W - R) / 2 : W - R - (i * (W - L - R)) / (n - 1)); // روز اول سمت راست (RTL)
    const yAt = (v, mx) => T + (1 - (v || 0) / mx) * (H - T - B);

    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'pf-svg', role: 'img', 'aria-label': `نمودار ${o.metrics.map((m) => m.label).join('، ')}؛ جدول روزانه‌ی معادل پایین صفحه است.` });
    grid(svg, 4);
    for (let i = 0; i <= 4; i += 1) {
      const y = T + (i * (H - T - B)) / 4;
      let txt;
      if (data.length === 1 || allMin) {
        const mx = data.length === 1 ? maxOf(data[0], 0) : sharedMax; const v = mx * (1 - i / 4); const m0 = data[0].m;
        txt = (allMin || m0.kind === 'min') ? `${D.fa(Math.round((v / 60) * 10) / 10)} س` : (m0.kind === 'money' ? `${D.fa(Math.round((v / 1e6) * 10) / 10)}م` : D.fa(Math.round(v * 10) / 10));
      } else txt = `${D.fa(100 - i * 25)}٪`;
      svg.appendChild(el('text', { x: L - 8, y: y + 4, class: 'pf-axis', 'text-anchor': 'end' }, txt));
    }
    const every = Math.max(1, Math.ceil(n / 8));
    rows.forEach((r, i) => { if (i % every === 0) svg.appendChild(el('text', { x: xAt(i), y: H - 10, class: 'pf-axis', 'text-anchor': 'middle' }, D.shortDate(r.date))); });
    const path = (vals, mx) => vals.map((v, i) => `${i ? 'L' : 'M'}${xAt(i).toFixed(1)},${yAt(v, mx).toFixed(1)}`).join(' ');
    data.forEach((s, idx) => {
      const mx = maxOf(s, idx);
      if (idx === 0 && s.prev && s.prev.length) {
        const pv = s.prev.slice(0, n);
        svg.appendChild(el('path', { d: path(pv, mx), class: 'pf-line pf-prev' }));
      }
      const d = path(s.cur, mx);
      if (n > 1) svg.appendChild(el('path', { d: `${d} L${xAt(n - 1).toFixed(1)},${H - B} L${xAt(0).toFixed(1)},${H - B} Z`, class: `pf-area pf-m-${s.m.key}` }));
      svg.appendChild(el('path', { d, class: `pf-line pf-m-${s.m.key}` }));
      if (n <= 35) s.cur.forEach((v, i) => svg.appendChild(el('circle', { cx: xAt(i).toFixed(1), cy: yAt(v, mx).toFixed(1), r: 3.2, class: `pf-pt pf-m-${s.m.key}` })));
    });
    const guide = el('line', { y1: T, y2: H - B, class: 'pf-guide', visibility: 'hidden' });
    svg.appendChild(guide);
    const hit = el('rect', { x: L, y: T, width: W - L - R, height: H - T - B, class: 'pf-hit' });
    svg.appendChild(hit);
    host.appendChild(svg); host.appendChild(tip);
    const show = (clientX) => {
      const box = svg.getBoundingClientRect();
      const x = ((clientX - box.left) / box.width) * W;
      let best = 0; let bd = Infinity;
      for (let i = 0; i < n; i += 1) { const dd = Math.abs(xAt(i) - x); if (dd < bd) { bd = dd; best = i; } }
      const r = rows[best];
      guide.setAttribute('x1', xAt(best)); guide.setAttribute('x2', xAt(best)); guide.setAttribute('visibility', 'visible');
      const first = data[0];
      const prevRow = o.prev && o.prev[best];
      tip.innerHTML = `<b>${D.esc(o.dateLabel ? o.dateLabel(r.date) : r.date)}</b>${o.statusLabel ? `<small>${D.esc(o.statusLabel(r))}</small>` : ''}${data.map((s) => `<span class="pf-tip-row pf-m-${s.m.key}"><i class="pf-dot"></i>${D.esc(s.m.label)}<em>${metricText(s.m, s.cur[best])}</em></span>`).join('')}${first.prev && prevRow ? `<span class="pf-tip-row pf-tip-prev"><i class="pf-dot"></i>${D.esc(first.m.label)} — دوره‌ی قبل<em>${metricText(first.m, first.prev[best] || 0)}</em></span>` : ''}${cum ? '<small>مقادیر تجمعی از ابتدای بازه</small>' : ''}`;
      tip.hidden = false; placeTip(tip, svg, xAt(best));
    };
    hit.addEventListener('pointermove', (e) => show(e.clientX));
    hit.addEventListener('pointerdown', (e) => show(e.clientX));
    hit.addEventListener('pointerleave', () => { tip.hidden = true; guide.setAttribute('visibility', 'hidden'); });
    if (data.length === 1 || allMin) return `محور عمودی بر حسب ${allMin ? 'ساعت' : 'مقدار'} است.${cum ? ' نمودار تجمعی است.' : ''}${data[0].prev ? ' خط خاکستری چین‌دار = دوره‌ی قبل (برای شاخص اول).' : ''}`;
    return 'شاخص‌های با واحد متفاوت هرکدام نسبت به بیشینه‌ی خودشان (۱۰۰٪) رسم شده‌اند؛ مقدار واقعی را در نکته‌ی نمودار ببینید.';
  }

  // ---------- ساعت ورود و خروج ----------
  function timesChart(host, rows, avgIn, avgOut) {
    const tip = wrap(host);
    const vals = rows.flatMap((r) => [r.checkIn, r.checkOut]).filter((v) => v != null);
    if (!vals.length) { emptyMsg(host, 'در این بازه ورود/خروجی ثبت نشده است.'); return; }
    const lo = Math.max(0, Math.floor((Math.min(...vals) - 20) / 60) * 60);
    const hi = Math.min(24 * 60, Math.ceil((Math.max(...vals) + 20) / 60) * 60);
    const n = rows.length;
    const xAt = (i) => (n === 1 ? (L + W - R) / 2 : W - R - (i * (W - L - R)) / (n - 1));
    const yAt = (v) => T + ((v - lo) / (hi - lo || 1)) * (H - T - B); // دیرتر = پایین‌تر
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'pf-svg', role: 'img', 'aria-label': 'ساعت ورود و خروج هر روز' });
    const steps = Math.max(1, Math.round((hi - lo) / 60));
    for (let i = 0; i <= steps; i += 1) {
      const y = T + (i * (H - T - B)) / steps;
      svg.appendChild(el('line', { x1: L, x2: W - R, y1: y, y2: y, class: 'pf-grid' }));
      svg.appendChild(el('text', { x: L - 8, y: y + 4, class: 'pf-axis', 'text-anchor': 'end' }, clock(lo + (i * (hi - lo)) / steps)));
    }
    const every = Math.max(1, Math.ceil(n / 8));
    rows.forEach((r, i) => { if (i % every === 0) svg.appendChild(el('text', { x: xAt(i), y: H - 10, class: 'pf-axis', 'text-anchor': 'middle' }, D.shortDate(r.date))); });
    const segPath = (key) => { let d = ''; let open = false; rows.forEach((r, i) => { const v = r[key]; if (v == null) { open = false; return; } d += `${open ? 'L' : 'M'}${xAt(i).toFixed(1)},${yAt(v).toFixed(1)} `; open = true; }); return d.trim(); };
    [['checkIn', 'in', avgIn], ['checkOut', 'out', avgOut]].forEach(([key, cls, avg]) => {
      if (avg != null) {
        svg.appendChild(el('line', { x1: L, x2: W - R, y1: yAt(avg), y2: yAt(avg), class: `pf-avgline pf-m-${cls}` }));
        svg.appendChild(el('text', { x: W - R - 4, y: yAt(avg) - 5, class: `pf-avglabel pf-m-${cls}`, 'text-anchor': 'end' }, `میانگین ${cls === 'in' ? 'ورود' : 'خروج'} ${clock(avg)}`));
      }
      const d = segPath(key);
      if (d) svg.appendChild(el('path', { d, class: `pf-line pf-m-${cls}` }));
      rows.forEach((r, i) => { if (r[key] != null) svg.appendChild(el('circle', { cx: xAt(i).toFixed(1), cy: yAt(r[key]).toFixed(1), r: 3.4, class: `pf-pt pf-m-${cls}` })); });
    });
    const guide = el('line', { y1: T, y2: H - B, class: 'pf-guide', visibility: 'hidden' }); svg.appendChild(guide);
    const hit = el('rect', { x: L, y: T, width: W - L - R, height: H - T - B, class: 'pf-hit' }); svg.appendChild(hit);
    host.appendChild(svg); host.appendChild(tip);
    const show = (clientX) => {
      const box = svg.getBoundingClientRect(); const x = ((clientX - box.left) / box.width) * W;
      let best = 0; let bd = Infinity; for (let i = 0; i < n; i += 1) { const dd = Math.abs(xAt(i) - x); if (dd < bd) { bd = dd; best = i; } }
      const r = rows[best];
      guide.setAttribute('x1', xAt(best)); guide.setAttribute('x2', xAt(best)); guide.setAttribute('visibility', 'visible');
      tip.innerHTML = `<b>${D.esc(D.shortDate(r.date))}</b><span class="pf-tip-row pf-m-in"><i class="pf-dot"></i>ورود<em>${clock(r.checkIn)}</em></span><span class="pf-tip-row pf-m-out"><i class="pf-dot"></i>خروج<em>${clock(r.checkOut)}</em></span>${r.late ? `<small>تأخیر ${D.esc(D.fmt.min(r.late))}</small>` : ''}`;
      tip.hidden = false; placeTip(tip, svg, xAt(best));
    };
    hit.addEventListener('pointermove', (e) => show(e.clientX)); hit.addEventListener('pointerdown', (e) => show(e.clientX));
    hit.addEventListener('pointerleave', () => { tip.hidden = true; guide.setAttribute('visibility', 'hidden'); });
  }

  // ---------- میله‌ای (+ خط تجمعی اختیاری) ----------
  // items: [{ label, value, sub? }]؛ o: { unit:'money'|'min'|'count', cumulative:boolean }
  function barsChart(host, items, o = {}) {
    const tip = wrap(host);
    if (!items.length || !items.some((x) => x.value > 0)) { emptyMsg(host, 'داده‌ای برای نمایش نیست.'); return; }
    const n = items.length;
    const mx = niceMax(Math.max(...items.map((x) => x.value)));
    const bw = (W - L - R) / n;
    const xC = (i) => W - R - (i + 0.5) * bw; // RTL
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: `pf-svg${o.tone ? ` pf-svg-${o.tone}` : ''}`, role: 'img', 'aria-label': o.aria || 'نمودار میله‌ای' });
    const gid = `pfg${Math.random().toString(36).slice(2, 8)}`;
    const defs = el('defs');
    const lg = el('linearGradient', { id: gid, x1: 0, y1: 0, x2: 0, y2: 1 });
    lg.appendChild(el('stop', { offset: '0%', class: 'pf-gs-a' })); lg.appendChild(el('stop', { offset: '100%', class: 'pf-gs-b' }));
    defs.appendChild(lg); svg.appendChild(defs);
    grid(svg, 4);
    for (let i = 0; i <= 4; i += 1) {
      const v = mx * (1 - i / 4);
      const txt = o.unit === 'money' ? `${D.fa(Math.round((v / 1e6) * 10) / 10)}م` : o.unit === 'min' ? `${D.fa(Math.round((v / 60) * 10) / 10)} س` : D.fa(Math.round(v * 10) / 10);
      svg.appendChild(el('text', { x: L - 8, y: T + (i * (H - T - B)) / 4 + 4, class: 'pf-axis', 'text-anchor': 'end' }, txt));
    }
    const every = Math.max(1, Math.ceil(n / 10));
    const fmtVal = (v) => (o.unit === 'money' ? `${D.fmt.num(v)} تومان` : o.unit === 'min' ? D.fmt.min(v) : D.fmt.num(v));
    const cumVals = []; let run = 0; items.forEach((x) => { run += x.value; cumVals.push(run); });
    const cmx = niceMax(run);
    const maxVal = Math.max(...items.map((x) => x.value));
    const avg = items.length > 1 && !o.cumulative ? run / n : null;
    const shortMoney = (v) => `${D.fa(Math.round((v / 1e6) * 10) / 10)}م`;
    const shortVal = (v) => (o.unit === 'money' ? shortMoney(v) : o.unit === 'min' ? D.fmt.min(v) : D.fmt.num(v));
    items.forEach((x, i) => {
      const h = ((H - T - B) * x.value) / mx;
      const w = Math.max(3, Math.min(64, bw - Math.min(10, bw * 0.3)));
      const g = el('g', { tabindex: 0, class: 'pf-hour' });
      g.appendChild(el('rect', { x: xC(i) - bw / 2, y: T, width: bw, height: H - T - B, class: 'pf-hit' }));
      if (h > 0) {
        const top = x.value === maxVal;
        g.appendChild(el('rect', { x: xC(i) - w / 2, y: H - B - h, width: w, height: h, rx: Math.min(10, w / 2.4), fill: `url(#${gid})`, class: `pf-bar-grad${top ? ' pf-bar-top' : ''}${x.tone ? ` pf-tone-${x.tone}` : ''}` }));
        if (n <= 14) g.appendChild(el('text', { x: xC(i), y: Math.max(T + 10, H - B - h - 7), class: `pf-bar-val${top ? ' pf-bar-val-top' : ''}`, 'text-anchor': 'middle' }, shortVal(x.value)));
      }
      const show = () => { tip.innerHTML = `<b>${D.esc(x.label)}</b>${x.sub ? `<small>${D.esc(x.sub)}</small>` : ''}<span class="pf-tip-row pf-m-useful"><i class="pf-dot"></i>${D.esc(o.valueLabel || 'مقدار')}<em>${fmtVal(x.value)}</em></span>${o.cumulative ? `<span class="pf-tip-row pf-m-tasksDone"><i class="pf-dot"></i>تجمعی<em>${fmtVal(cumVals[i])}</em></span>` : ''}`; tip.hidden = false; placeTip(tip, svg, xC(i)); };
      g.addEventListener('pointerenter', show); g.addEventListener('focus', show);
      g.addEventListener('pointerleave', () => { tip.hidden = true; }); g.addEventListener('blur', () => { tip.hidden = true; });
      svg.appendChild(g);
      if (i % every === 0) svg.appendChild(el('text', { x: xC(i), y: H - 10, class: 'pf-axis', 'text-anchor': 'middle' }, x.short || x.label));
    });
    if (avg != null) {
      const ya = T + (1 - avg / mx) * (H - T - B);
      svg.appendChild(el('line', { x1: L, x2: W - R, y1: ya, y2: ya, class: 'pf-avgline pf-m-tasksDone' }));
      svg.appendChild(el('text', { x: W - R - 4, y: ya - 5, class: 'pf-avglabel pf-m-tasksDone', 'text-anchor': 'end' }, `میانگین ${shortVal(avg)}`));
    }
    if (o.cumulative && n > 1) {
      const d = cumVals.map((v, i) => `${i ? 'L' : 'M'}${xC(i).toFixed(1)},${(T + (1 - v / cmx) * (H - T - B)).toFixed(1)}`).join(' ');
      svg.appendChild(el('path', { d, class: 'pf-line pf-m-tasksDone pf-ontop' }));
    }
    host.appendChild(svg); host.appendChild(tip);
  }

  // ---------- ساعت‌به‌ساعت (۲۴ سطل) ----------
  function hourlyChart(host, hourly) {
    const tip = wrap(host);
    const hrs = hourly.hours;
    if (!hrs.reduce((a, h) => a + h.present, 0)) { emptyMsg(host, 'در این روز حضوری ثبت نشده است.'); return; }
    const bw = (W - L - R) / 24;
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'pf-svg', role: 'img', 'aria-label': 'دقیقه‌ی کار و استراحت در هر ساعت از روز' });
    grid(svg, 4);
    for (let i = 0; i <= 4; i += 1) svg.appendChild(el('text', { x: L - 8, y: T + (i * (H - T - B)) / 4 + 4, class: 'pf-axis', 'text-anchor': 'end' }, D.fa(60 - i * 15)));
    hrs.forEach((h, i) => {
      const x = L + i * bw + 3; const w = bw - 6;
      const hw = ((H - T - B) * h.working) / 60; const hb = ((H - T - B) * h.onBreak) / 60;
      const g = el('g', { class: 'pf-hour', tabindex: 0 });
      g.appendChild(el('rect', { x: L + i * bw, y: T, width: bw, height: H - T - B, class: 'pf-hit' }));
      if (hw > 0) g.appendChild(el('rect', { x, y: H - B - hw, width: w, height: hw, rx: 3, class: 'pf-bar-work' }));
      if (hb > 0) g.appendChild(el('rect', { x, y: H - B - hw - hb, width: w, height: hb, rx: 3, class: 'pf-bar-break' }));
      const show = () => { tip.innerHTML = `<b>${D.fa(String(h.hour).padStart(2, '0'))}:۰۰ تا ${D.fa(String((h.hour + 1) % 24).padStart(2, '0'))}:۰۰</b><span class="pf-tip-row pf-m-useful"><i class="pf-dot"></i>کار<em>${D.fmt.min(Math.round(h.working))}</em></span><span class="pf-tip-row pf-m-breaks"><i class="pf-dot"></i>استراحت<em>${D.fmt.min(Math.round(h.onBreak))}</em></span>`; tip.hidden = false; placeTip(tip, svg, L + (i + 0.5) * bw); };
      g.addEventListener('pointerenter', show); g.addEventListener('focus', show);
      g.addEventListener('pointerleave', () => { tip.hidden = true; }); g.addEventListener('blur', () => { tip.hidden = true; });
      svg.appendChild(g);
      if (i % 2 === 0) svg.appendChild(el('text', { x: L + (i + 0.5) * bw, y: H - 10, class: 'pf-axis', 'text-anchor': 'middle' }, D.fa(String(h.hour).padStart(2, '0'))));
    });
    host.appendChild(svg); host.appendChild(tip);
  }

  root.PerfCharts = { init, lineChart, timesChart, barsChart, hourlyChart, clock };
}(typeof window !== 'undefined' ? window : globalThis));
