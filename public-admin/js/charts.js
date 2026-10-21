// نمودارهای SVG سبک پنل (S5-7a): بدون CDN و بدون وابستگی؛ خروجی «رشته‌ی HTML» است (مثل exports.js) تا بدون مرورگر تست شود.
// قرارداد:
//   • هر نمودار یک <figure> است: عنوان، <svg role="img"> (با <title>/<desc> و tooltip هر نقطه/میله) و زیرش «جدول داده‌ها»ی معادل
//     (<details> بسته‌ی پیش‌فرض؛ همان اعداد نمودار + ستون‌های تکمیلی). نمودار فقط «دیدن» است؛ منبع حقیقت جدول است.
//   • رنگ‌ها فقط با کلاس CSS (s0…s5) تعیین می‌شوند (CSP پنل تگ <style> را نمی‌پذیرد؛ تم تیره/روشن در S5-8a فقط CSS را عوض می‌کند).
//     رنگ تنها حامل معنی نیست: سری‌ها شکل نشانگر و الگوی خط متفاوت دارند و برچسب سری در راهنما و جدول هست.
//   • RTL: اولین دسته/سطل سمت راست است (جهت خواندن فارسی)؛ میله‌های افقی از راست رشد می‌کنند.
//   • مقدار null ⇒ «بدون داده»: در خط شکاف می‌افتد، در میله رسم نمی‌شود، در جدول «—» است (هرگز صفر جعلی نیست).
//   • همه‌ی متن‌ها escape می‌شوند؛ هیچ on*/style درون‌خطی تولید نمی‌شود.
// آداپتورهای fromXxx پاسخ APIهای S5-6 را به spec نمودار تبدیل می‌کنند (همان‌جا تست می‌شوند).
(function (root) {
  'use strict';

  const MAX_SERIES = 6; // سقف سری‌های «رسم‌شده» (بیشتر ⇒ فقط در جدول می‌آید و یادداشت می‌شود)
  const MARKERS = ['circle', 'square', 'triangle', 'diamond', 'circle', 'square'];
  const DASHES = ['', '6 3', '2 3', '8 3 2 3', '', '6 3']; // الگوی خط؛ خالی = پیوسته
  let uid = 0;

  const defaultEsc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const round2 = (x) => Math.round(x * 100) / 100;
  const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
  const n = (v) => (isNum(v) ? String(round2(v)) : '0'); // مختصات امن (هرگز NaN در صفت svg نمی‌رود)

  function makeDeps(deps = {}) {
    const esc = deps.esc || defaultEsc;
    const num = deps.num || ((v) => (isNum(v) ? String(round2(v)) : '—'));
    return {
      esc,
      num,
      fa: deps.fa || ((s) => String(s == null ? '' : s)), // تبدیل ارقام لاتین به فارسی (Jalali.toFaDigits)
      empty: deps.empty || 'داده‌ای برای نمایش نیست.',
    };
  }

  // بالاترین مقدار «گرد» محور (۱، ۲، ۲٫۵، ۵ × توان ۱۰) و گام آن؛ exact=true ⇒ بالای محور دقیقاً همان max (مثل ۱۰۰٪)
  function niceScale(max, ticks = 4, exact = false) {
  if (exact && isNum(max) && max > 0) return { max, step: max / ticks, ticks };
    if (!isNum(max) || max <= 0) return { max: 1, step: 1 / ticks, ticks };
    const raw = max / ticks;
    const pow = 10 ** Math.floor(Math.log10(raw));
    const f = raw / pow;
    const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * pow; // ۲٫۵ هم هست تا ۱۰۰ ⇒ ۱۰۰ (نه ۲۰۰)
    return { max: step * ticks, step, ticks };
  }

  const markerSvg = (shape, x, y, cls, title, d, seriesIndex) => {
    const t = title ? `<title>${d.esc(title)}</title>` : '';
    const a = title ? ` tabindex="0" role="img" aria-label="${d.esc(title)}" data-tip="${d.esc(title)}"${seriesIndex == null ? '' : ` data-series="${seriesIndex}"`}` : '';
    if (shape === 'square') return `<rect class="mk ${cls}" x="${n(x - 4)}" y="${n(y - 4)}" width="8" height="8"${a}>${t}</rect>`;
    if (shape === 'triangle') return `<polygon class="mk ${cls}" points="${n(x)},${n(y - 5)} ${n(x + 5)},${n(y + 4)} ${n(x - 5)},${n(y + 4)}"${a}>${t}</polygon>`;
    if (shape === 'diamond') return `<polygon class="mk ${cls}" points="${n(x)},${n(y - 5)} ${n(x + 5)},${n(y)} ${n(x)},${n(y + 5)} ${n(x - 5)},${n(y)}"${a}>${t}</polygon>`;
    return `<circle class="mk ${cls}" cx="${n(x)}" cy="${n(y)}" r="4"${a}>${t}</circle>`;
  };

  // برچسب‌های محور را کم می‌کند تا روی هم نیفتند (حداکثر ~maxLabels برچسب)
  const everyOf = (count, maxLabels) => Math.max(1, Math.ceil(count / maxLabels));

  // ---------- جدول معادل ----------
  // table: { headers: string[], rows: string[][] } (همه‌ی خانه‌ها «متن ساده»؛ اینجا escape می‌شوند)
  function tableHtml(table, d, caption) {
    const head = `<tr>${table.headers.map((h, i) => `<th scope="col">${d.esc(h)}</th>`).join('')}</tr>`;
    const body = table.rows.map((r) => `<tr><th scope="row">${d.esc(r[0])}</th>${r.slice(1).map((c) => `<td>${d.esc(c)}</td>`).join('')}</tr>`).join('');
    return `<details class="chart-data"><summary>جدول داده‌های «${d.esc(caption)}»</summary><div class="table-wrap"><table class="chart-table"><caption class="sr-only">${d.esc(caption)}</caption><thead>${head}</thead><tbody>${body}</tbody></table></div></details>`;
  }

  function legendHtml(series, d) {
    if (series.length < 2) return '';
    const items = series.map((s, i) => `<li><button type="button" data-chart-series="${i}" aria-pressed="true"><svg viewBox="0 0 22 12" width="22" height="12" aria-hidden="true"><line class="ln ${'s' + (i % 6)}" x1="1" x2="21" y1="6" y2="6"${DASHES[i % 6] ? ` stroke-dasharray="${DASHES[i % 6]}"` : ''}/>${markerSvg(MARKERS[i % 6], 11, 6, 's' + (i % 6), '', d)}</svg><span>${d.esc(s.name)}</span></button></li>`).join('');
    return `<ul class="chart-legend">${items}</ul>`;
  }

  function figure({ id, title, desc, svg, legend, note, table, d }) {
    return `<figure class="chart-fig" id="${d.esc(id)}"><figcaption>${d.esc(title)}</figcaption>${legend || ''}${svg}${note ? `<div class="chart-note">${d.esc(note)}</div>` : ''}${tableHtml(table, d, title)}</figure>`;
  }

  const emptyFigure = (title, d, message) => `<figure class="chart-fig"><figcaption>${d.esc(title)}</figcaption><div class="empty">${d.esc(message || d.empty)}</div></figure>`;

  // ---------- نمودار خطی ----------
  /**
   * @param {{title: string, labels: string[], tickLabels?: string[], series: Array<{name: string, values: Array<number|null>, texts?: string[]}>,
   *          tickFormat?: (v:number)=>string, valueFormat?: (v:number)=>string, table?: {headers: string[], rows: string[][]}, yMax?: number, note?: string}} spec
   */
  function lineChartHtml(spec, deps) {
    const d = makeDeps(deps);
    const labels = spec.labels || [];
    const all = spec.series || [];
    const hasAny = all.some((s) => (s.values || []).some(isNum));
    if (!labels.length || !hasAny) return emptyFigure(spec.title, d);
    const series = all.slice(0, MAX_SERIES);
    const fmtTick = spec.tickFormat || ((v) => d.num(v));
    const fmtVal = spec.valueFormat || fmtTick;
    const W = 720, H = 240, padT = 14, padB = 34, padL = 14, padR = 52; // محور مقدار سمت راست (RTL)
    const innerW = W - padL - padR, innerH = H - padT - padB;
    const dataMax = Math.max(0, ...series.flatMap((s) => s.values.filter(isNum)));
    const sc = (spec.yMax !== undefined ? niceScale(spec.yMax, 4, true) : niceScale(dataMax));
    const count = labels.length;
    // اولین سطل سمت راست؛ تک‌نقطه‌ای ⇒ وسط
    const xAt = (i) => (count === 1 ? padL + innerW / 2 : W - padR - (innerW * i) / (count - 1));
    const yAt = (v) => padT + innerH - (innerH * v) / sc.max;
    const gid = `ch${(uid += 1)}`;
    let g = '';
    for (let i = 0; i <= sc.ticks; i += 1) {
      const v = sc.step * i;
      const y = yAt(v);
      g += `<line class="grid" x1="${padL}" x2="${W - padR}" y1="${n(y)}" y2="${n(y)}"/><text class="ytick" x="${W - padR + 6}" y="${n(y + 4)}" text-anchor="start">${d.esc(fmtTick(v))}</text>`;
    }
    const ticks = spec.tickLabels || labels;
    const every = everyOf(count, 8);
    for (let i = 0; i < count; i += every) g += `<text class="xtick" x="${n(xAt(i))}" y="${H - 12}" text-anchor="middle">${d.esc(ticks[i])}</text>`;
    series.forEach((s, si) => {
      const cls = `s${si}`;
      g += `<g data-series="${si}">`;
      // شکاف برای null: هر قطعه‌ی پیوسته یک polyline
      let seg = [];
      const flush = () => { if (seg.length > 1) g += `<polyline class="ln ${cls}" fill="none"${DASHES[si] ? ` stroke-dasharray="${DASHES[si]}"` : ''} points="${seg.join(' ')}"/>`; seg = []; };
      s.values.forEach((v, i) => { if (isNum(v)) seg.push(`${n(xAt(i))},${n(yAt(v))}`); else flush(); });
      flush();
      s.values.forEach((v, i) => {
        if (!isNum(v)) return;
        const extra = s.texts && s.texts[i] ? ` — ${s.texts[i]}` : '';
        g += markerSvg(MARKERS[si], xAt(i), yAt(v), cls, `${s.name} · ${labels[i]}: ${fmtVal(v)}${extra}`, d, si);
      });
      g += '</g>';
    });
    const peak = series.map((s) => Math.max(...s.values.filter(isNum), -Infinity)).reduce((a, b) => Math.max(a, b), -Infinity);
    const desc = `نمودار خطی «${spec.title}»؛ ${d.num(count)} نقطه، ${d.num(series.length)} سری؛ بیشترین مقدار ${fmtVal(peak)}. اعداد دقیق در جدول زیر نمودار است.`;
    const svg = `<svg class="chart chart-line" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="${gid}-t ${gid}-d"><title id="${gid}-t">${d.esc(spec.title)}</title><desc id="${gid}-d">${d.esc(desc)}</desc>${g}</svg>`;
    const table = spec.table || {
      headers: ['بازه', ...all.map((s) => s.name)],
      rows: labels.map((l, i) => [l, ...all.map((s) => (isNum(s.values[i]) ? fmtVal(s.values[i]) : '—'))]),
    };
    const note = all.length > MAX_SERIES ? `فقط ${d.num(MAX_SERIES)} سری اول رسم شده؛ همه‌ی سری‌ها در جدول هست.` : spec.note;
    return figure({ id: gid, title: spec.title, desc, svg, legend: legendHtml(series, d), note, table, d });
  }

  // ---------- نمودار میله‌ای ----------
  /**
   * orientation: 'horizontal' (برچسب‌های بلند: رتبه‌ها، دپارتمان‌ها) | 'vertical' (توزیع/هیستوگرام)
   * @param {{title: string, categories: string[], series: Array<{name: string, values: Array<number|null>}>, orientation?: string,
   *          tickFormat?: Function, valueFormat?: Function, table?: object, yMax?: number, note?: string, tickLabels?: string[]}} spec
   */
  function barChartHtml(spec, deps) {
    const d = makeDeps(deps);
    const cats = spec.categories || [];
    const all = spec.series || [];
    const hasAny = all.some((s) => (s.values || []).some(isNum));
    if (!cats.length || !hasAny) return emptyFigure(spec.title, d);
    const series = all.slice(0, MAX_SERIES);
    const horizontal = spec.orientation !== 'vertical';
    const fmtTick = spec.tickFormat || ((v) => d.num(v));
    const fmtVal = spec.valueFormat || fmtTick;
    const dataMax = Math.max(0, ...series.flatMap((s) => s.values.filter(isNum)));
    const sc = (spec.yMax !== undefined ? niceScale(spec.yMax, 4, true) : niceScale(dataMax));
    const gid = `ch${(uid += 1)}`;
    const k = series.length;
    let g = '';
    let H;
    const W = 720;
    if (horizontal) {
      const rowH = k * 14 + 14;
      const padT = 8, padB = 26, labelW = 150, padL = 14;
      H = padT + padB + rowH * cats.length;
      const x0 = W - labelW; // خط پایه‌ی میله‌ها سمت راست
      const innerW = x0 - padL;
      const wAt = (v) => (innerW * v) / sc.max;
      for (let i = 0; i <= sc.ticks; i += 1) {
        const x = x0 - wAt(sc.step * i);
        g += `<line class="grid" x1="${n(x)}" x2="${n(x)}" y1="${padT}" y2="${H - padB}"/><text class="xtick" x="${n(x)}" y="${H - 8}" text-anchor="middle">${d.esc(fmtTick(sc.step * i))}</text>`;
      }
      cats.forEach((c, ci) => {
        const top = padT + rowH * ci;
        const label = String(c).length > 22 ? `${String(c).slice(0, 21)}…` : String(c);
        g += `<text class="cat" x="${W - 8}" y="${n(top + rowH / 2 + 4)}" text-anchor="end">${d.esc(label)}<title>${d.esc(c)}</title></text>`;
        series.forEach((s, si) => {
          const v = s.values[ci];
          if (!isNum(v)) return;
          const w = Math.max(v > 0 ? 2 : 0, wAt(v));
          const y = top + 7 + si * 14;
          const tip = `${k > 1 ? `${s.name} · ` : ''}${c}: ${fmtVal(v)}`;
          g += `<g data-series="${si}"><title>${d.esc(tip)}</title><rect class="bar ${'s' + si}" tabindex="0" role="img" aria-label="${d.esc(tip)}" data-tip="${d.esc(tip)}" x="${n(x0 - w)}" y="${n(y)}" width="${n(w)}" height="10" rx="2"/><text class="val" x="${n(x0 - w - 5)}" y="${n(y + 9)}" text-anchor="end">${d.esc(fmtVal(v))}</text></g>`;
        });
      });
    } else {
      H = 240;
      const padT = 18, padB = 34, padL = 14, padR = 52;
      const innerW = W - padL - padR, innerH = H - padT - padB;
      const slot = innerW / cats.length;
      const bw = Math.max(3, Math.min(34, (slot * 0.78) / k));
      const hAt = (v) => (innerH * v) / sc.max;
      for (let i = 0; i <= sc.ticks; i += 1) {
        const y = padT + innerH - hAt(sc.step * i);
        g += `<line class="grid" x1="${padL}" x2="${W - padR}" y1="${n(y)}" y2="${n(y)}"/><text class="ytick" x="${W - padR + 6}" y="${n(y + 4)}" text-anchor="start">${d.esc(fmtTick(sc.step * i))}</text>`;
      }
      const ticks = spec.tickLabels || cats;
      const every = everyOf(cats.length, 12);
      cats.forEach((c, ci) => {
        const cx = W - padR - (ci + 0.5) * slot; // اولین دسته سمت راست
        if (ci % every === 0) g += `<text class="xtick" x="${n(cx)}" y="${H - 12}" text-anchor="middle">${d.esc(ticks[ci])}</text>`;
        series.forEach((s, si) => {
          const v = s.values[ci];
          if (!isNum(v)) return;
          const h = Math.max(v > 0 ? 2 : 0, hAt(v));
          const x = cx - (k * bw) / 2 + si * bw;
          const tip = `${k > 1 ? `${s.name} · ` : ''}${c}: ${fmtVal(v)}`;
          g += `<g data-series="${si}"><title>${d.esc(tip)}</title><rect class="bar ${'s' + si}" tabindex="0" role="img" aria-label="${d.esc(tip)}" data-tip="${d.esc(tip)}" x="${n(x)}" y="${n(padT + innerH - h)}" width="${n(bw - 1)}" height="${n(h)}" rx="2"/></g>`;
        });
      });
    }
    const top = series.map((s) => Math.max(...s.values.filter(isNum), -Infinity)).reduce((a, b) => Math.max(a, b), -Infinity);
    const desc = `نمودار میله‌ای «${spec.title}»؛ ${d.num(cats.length)} دسته${k > 1 ? `، ${d.num(k)} سری` : ''}؛ بیشترین مقدار ${fmtVal(top)}. اعداد دقیق در جدول زیر نمودار است.`;
    const svg = `<svg class="chart chart-bar" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="${gid}-t ${gid}-d"><title id="${gid}-t">${d.esc(spec.title)}</title><desc id="${gid}-d">${d.esc(desc)}</desc>${g}</svg>`;
    const table = spec.table || {
      headers: ['دسته', ...all.map((s) => s.name)],
      rows: cats.map((c, i) => [c, ...all.map((s) => (isNum(s.values[i]) ? fmtVal(s.values[i]) : '—'))]),
    };
    const note = all.length > MAX_SERIES ? `فقط ${d.num(MAX_SERIES)} سری اول رسم شده؛ همه‌ی سری‌ها در جدول هست.` : spec.note;
    return figure({ id: gid, title: spec.title, desc, svg, legend: legendHtml(series, d), note, table, d });
  }

  // ======================================================
  // آداپتورها: پاسخ API ⇒ spec (همه خالص؛ deps: { num, fa, min })
  // ======================================================
  const hours = (m, d) => `${d.num(Math.round((m / 60) * 10) / 10)} ساعت`; // محور: یک رقم اعشار (۳٫۳ نه ۳٫۳۳)
  const percent = (r, d) => (isNum(r) ? `${d.num(round2(r * 100))}٪` : '—');
  const D = (deps) => ({ ...makeDeps(deps), min: (deps && deps.min) || ((m) => (isNum(m) ? `${m} دقیقه` : '—')) });

  /** GET /analytics/late-trend ⇒ نمودار خطی «نرخ تأخیر» (برای هر سری یک خط) + جدول با تعداد و دقیقه */
  function fromLateTrend(data, deps) {
    const d = D(deps);
    const buckets = data.buckets || [];
    const series = (data.series || []).map((s) => ({
      name: s.label,
      values: s.points.map((p) => (isNum(p.lateRate) ? round2(p.lateRate * 100) : null)),
      texts: s.points.map((p) => `${d.num(p.lateCount)} روز تأخیر از ${d.num(p.presentDays)} روز حضور`),
    }));
    const rows = [];
    for (let i = 0; i < buckets.length; i += 1) {
      const row = [d.fa(buckets[i].label)];
      for (const s of data.series || []) {
        const p = s.points[i];
        row.push(isNum(p.lateRate) ? `${percent(p.lateRate, d)} (${d.num(p.lateCount)} از ${d.num(p.presentDays)} روز؛ ${d.min(p.lateMinutes)})` : `— (حضوری ثبت نشده)`);
      }
      rows.push(row);
    }
    const strip = (l) => d.fa(String(l).replace(/^هفته‌ی\s*/, '').replace(/^(\d{4})\/(\d{2})\/(\d{2})$/, '$2/$3'));
    return {
      title: data.granularity === 'month' ? 'روند ماهانه‌ی نرخ تأخیر' : 'روند هفتگی نرخ تأخیر',
      labels: buckets.map((b) => d.fa(b.label)),
      tickLabels: buckets.map((b) => strip(b.label)),
      series,
      tickFormat: (v) => `${d.num(round2(v))}٪`,
      valueFormat: (v) => `${d.num(round2(v))}٪`,
      table: { headers: ['بازه', ...(data.series || []).map((s) => s.label)], rows },
      note: 'نرخ تأخیر = روز با تأخیر ÷ روز حضور؛ بازه‌ی بدون حضور «بدون داده» است (نقطه‌ی صفر نیست).',
    };
  }

  /** GET /analytics/late-compare ⇒ میله‌ی گروهی «ماه قبل در برابر ماه جاری» (نرخ تأخیر) */
  function fromLateCompare(data, deps) {
    const d = D(deps);
    const groups = data.groupBy && data.groupBy !== 'none' && data.groups && data.groups.length ? data.groups : null;
    const cats = groups ? groups.map((g) => g.label) : ['همه'];
    const cur = groups ? groups.map((g) => g.current) : [data.current];
    const prev = groups ? groups.map((g) => g.previous) : [data.previous];
    const rate = (x) => (isNum(x.lateRate) ? round2(x.lateRate * 100) : null);
    const dl = groups ? groups.map((g) => g.delta) : [data.delta];
    return {
      title: 'نرخ تأخیر: ماه جاری در برابر ماه قبل',
      categories: cats,
      series: [{ name: d.fa(data.previous.label), values: prev.map(rate) }, { name: `${d.fa(data.current.label)}${data.current.partial ? ' (ناتمام)' : ''}`, values: cur.map(rate) }],
      orientation: 'horizontal',
      tickFormat: (v) => `${d.num(round2(v))}٪`,
      table: {
        headers: ['دسته', `نرخ ${d.fa(data.previous.label)}`, `نرخ ${d.fa(data.current.label)}`, 'تعداد تأخیر (قبل ⇒ جاری)', 'تغییر تعداد'],
        rows: cats.map((c, i) => [c, percent(prev[i].lateRate, d), percent(cur[i].lateRate, d), `${d.num(prev[i].lateCount)} ⇒ ${d.num(cur[i].lateCount)}`, isNum(dl[i].lateCountPercent) ? `${d.num(dl[i].lateCountPercent)}٪` : 'نامعلوم (ماه قبل تأخیری نداشته)']),
      },
      note: data.current.partial ? 'ماه جاری هنوز تمام نشده؛ برای مقایسه‌ی منصفانه «نرخ» را ببینید، نه تعداد.' : undefined,
    };
  }

  /** GET /analytics/rankings ⇒ میله‌ی افقی؛ فقط مقدار مثبت رتبه دارد (خالی ⇒ پیام «داده‌ای نیست») */
  function fromRankings(data, deps) {
    const d = D(deps);
    const over = data.metric === 'overtime';
    const key = over ? 'payableMinutes' : 'shortfallMinutes';
    const rows = data.rows || [];
    return {
      title: over ? 'رتبه‌ی اضافه‌کاری قابل‌پرداخت' : 'رتبه‌ی کسری کار',
      categories: rows.map((r) => `${d.num(r.rank)}. ${r.user.fullName}`),
      series: [{ name: over ? 'اضافه‌کاری قابل‌پرداخت' : 'کسری', values: rows.map((r) => r[key]) }],
      tickFormat: (v) => hours(v, d),
      valueFormat: (v) => d.min(v),
      table: over
        ? { headers: ['رتبه و نام', 'دپارتمان', 'قابل‌پرداخت', 'خام', 'معلق'], rows: rows.map((r) => [`${d.num(r.rank)}. ${r.user.fullName}`, r.user.department || '—', d.min(r.payableMinutes), d.min(r.rawMinutes), d.min(r.pendingMinutes)]) }
        : { headers: ['رتبه و نام', 'دپارتمان', 'کسری', 'نسبت به مورد انتظار', 'روز ناقص'], rows: rows.map((r) => [`${d.num(r.rank)}. ${r.user.fullName}`, r.user.department || '—', d.min(r.shortfallMinutes), percent(r.shortfallRatio, d), d.num(r.incompleteDays)]) },
      note: data.definition,
    };
  }

  /** GET /analytics/attendance-rate?groupBy=department|user ⇒ میله‌ی افقی با محور ثابت ۰ تا ۱۰۰٪ */
  function fromAttendanceRate(data, deps) {
    const d = D(deps);
    const groups = data.groups && data.groups.length ? data.groups : [{ label: 'همه', ...data.total }];
    return {
      title: 'نرخ حضور',
      categories: groups.map((g) => g.label),
      series: [{ name: 'نرخ حضور', values: groups.map((g) => (isNum(g.rate) ? round2(g.rate * 100) : null)) }],
      yMax: 100,
      tickFormat: (v) => `${d.num(round2(v))}٪`,
      table: { headers: ['گروه', 'نرخ حضور', 'روز حضور', 'روز غیبت', 'روز تأخیر'], rows: groups.map((g) => [g.label, percent(g.rate, d), d.num(g.presentDays), d.num(g.absentDays), d.num(g.lateDays)]) },
      note: data.definition,
    };
  }

  /** GET /analytics/leave-by-type ⇒ میله‌ی افقی (روز تمام‌روز)؛ دقیقه‌ی ساعتی/نیم‌روز در جدول */
  function fromLeaveByType(data, deps) {
    const d = D(deps);
    const types = data.types || [];
    return {
      title: 'مرخصی و مأموریت به‌تفکیک نوع',
      categories: types.map((t) => t.title),
      series: [{ name: 'روز', values: types.map((t) => t.days) }],
      tickFormat: (v) => d.num(round2(v)),
      valueFormat: (v) => `${d.num(round2(v))} روز`,
      table: { headers: ['نوع', 'روز', 'دقیقه‌ی ساعتی/نیم‌روز', 'کارمند'], rows: types.map((t) => [t.title, d.num(t.days), d.min(t.minutes), d.num(t.employees)]) },
      note: 'نمودار فقط «روز تمام‌روز» را نشان می‌دهد؛ مقدار ساعتی/نیم‌روز در جدول است.',
    };
  }

  /** GET /analytics/checkin-distribution ⇒ هیستوگرام عمودی (تعداد ورود در هر سطل ساعتی) */
  function fromCheckinDistribution(data, deps) {
    const d = D(deps);
    const bins = data.bins || [];
    return {
      title: 'توزیع ساعت ورود',
      categories: bins.map((b) => `${d.fa(b.from)}–${d.fa(b.to)}`),
      tickLabels: bins.map((b) => d.fa(b.from)),
      series: [{ name: 'تعداد ورود', values: bins.map((b) => b.count) }],
      orientation: 'vertical',
      tickFormat: (v) => d.num(round2(v)),
      valueFormat: (v) => `${d.num(v)} ورود`,
      table: { headers: ['بازه‌ی ساعت', 'تعداد ورود'], rows: bins.map((b) => [`${d.fa(b.from)} تا ${d.fa(b.to)}`, d.num(b.count)]) },
      note: data.count ? `${d.num(data.count)} ورود؛ زودترین ${d.fa(data.earliest)}، میانه ${d.fa(data.median)}، دیرترین ${d.fa(data.latest)} (به وقت شرکت).` : undefined,
    };
  }

  function mountInteractiveCharts(rootEl) {
    if (!rootEl || rootEl.dataset.chartsInteractive === '1') return;
    rootEl.dataset.chartsInteractive = '1';
    const hideTip = (fig) => { const old = fig && fig.querySelector('.chart-tooltip'); if (old) old.remove(); };
    const showTip = (target) => {
      const fig = target.closest('.chart-fig');
      if (!fig) return;
      hideTip(fig);
      const tip = document.createElement('div');
      tip.className = 'chart-tooltip';
      tip.textContent = target.dataset.tip;
      const r = target.getBoundingClientRect();
      const fr = fig.getBoundingClientRect();
      tip.style.left = `${Math.max(8, Math.min(fr.width - 220, r.left - fr.left))}px`;
      tip.style.top = `${Math.max(40, r.top - fr.top - 38)}px`;
      fig.appendChild(tip);
    };
    rootEl.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-chart-series]');
      if (!btn) return;
      const fig = btn.closest('.chart-fig');
      const idx = btn.dataset.chartSeries;
      const pressed = btn.getAttribute('aria-pressed') !== 'false';
      btn.setAttribute('aria-pressed', pressed ? 'false' : 'true');
      fig.querySelectorAll(`.chart [data-series="${idx}"]`).forEach((el) => el.classList.toggle('is-series-hidden', pressed));
    });
    rootEl.addEventListener('pointerover', (e) => { const t = e.target.closest('[data-tip]'); if (t) showTip(t); });
    rootEl.addEventListener('pointerout', (e) => { const fig = e.target.closest('.chart-fig'); if (fig && !e.relatedTarget?.closest?.('.chart-tooltip')) hideTip(fig); });
    rootEl.addEventListener('focusin', (e) => { const t = e.target.closest('[data-tip]'); if (t) showTip(t); });
    rootEl.addEventListener('focusout', (e) => hideTip(e.target.closest('.chart-fig')));
  }

  const api = { MAX_SERIES, niceScale, lineChartHtml, barChartHtml, fromLateTrend, fromLateCompare, fromRankings, fromAttendanceRate, fromLeaveByType, fromCheckinDistribution, mountInteractiveCharts };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.AnalyticsCharts = api;
}(typeof window !== 'undefined' ? window : undefined));
