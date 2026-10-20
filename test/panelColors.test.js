// فاز ۱۶ / T7: داشبورد، نمودارها، هفته‌ی کارمند، تقویم، برنامه‌ی روزبه‌روز و رنگ‌های سخت‌کد در JS — بررسی ایستا از روی کد و CSS واقعی + کنتراست AA.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');
const CSS = read('public-admin/css/style.css');
const JS_DIR = path.join(ROOT, 'public-admin/js');
const JS_FILES = fs.readdirSync(JS_DIR).filter((f) => f.endsWith('.js'));

// ---------- ابزار رنگ (مثل بقیه‌ی تست‌های فاز ۱۶) ----------
const parseColor = (v) => {
  v = v.trim();
  let m = v.match(/^#([0-9a-f]{6})$/i);
  if (m) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)).concat(1);
  m = v.match(/^rgba?\(([^)]+)\)$/);
  if (m) { const p = m[1].split(',').map((x) => parseFloat(x)); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]; }
  throw new Error(`رنگ نامعتبر: ${v}`);
};
const over = (fg, bg) => { const a = fg[3]; return [0, 1, 2].map((i) => fg[i] * a + bg[i] * (1 - a)).concat(1); };
const lum = ([r, g, b]) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
function block(css, selector) {
  const i = css.indexOf(`${selector} {`);
  assert.ok(i >= 0, `بلاک ${selector} نیست`);
  return css.slice(i + selector.length + 2, css.indexOf('\n}', i));
}
const varsOf = (txt) => Object.fromEntries([...txt.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
const THEMES = { dark: varsOf(block(CSS, ':root,\n:root[data-theme="dark"]')), light: varsOf(block(CSS, ':root[data-theme="light"]')) };

// CSS بدون کامنت و بدون بلوک‌های @media print (چاپ عمداً پالت روشنِ سخت‌کد دارد و دست‌نخورده می‌ماند)
function stripBlocks(css, startRe) {
  let out = ''; let i = 0;
  for (;;) {
    const m = startRe.exec(css.slice(i));
    if (!m) { out += css.slice(i); break; }
    const start = i + m.index;
    out += css.slice(i, start);
    let depth = 0; let j = css.indexOf('{', start);
    for (; j < css.length; j += 1) { if (css[j] === '{') depth += 1; else if (css[j] === '}') { depth -= 1; if (depth === 0) { j += 1; break; } } }
    i = j;
  }
  return out;
}
const SCREEN_CSS = stripBlocks(CSS.replace(/\/\*[\s\S]*?\*\//g, ''), /@media print\s*\{/);
const RULES = [...SCREEN_CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sels: m[1].split(/,(?![^(]*\))/).map((x) => x.trim()), body: m[2].trim() }));
const bodyOf = (sel) => { const r = RULES.filter((x) => x.sels.includes(sel)).map((x) => x.body).join(' '); assert.ok(r, `قاعده‌ی ${sel} نیست`); return r; };

// ---------- ۱) ممیزی رنگ سخت‌کد در JS ----------
describe('T7: رنگ سخت‌کد در public-admin/js', () => {
  const BASELINE_JS = 8; // ممیزی T1: views-main ۵ + views-admin ۲ + views-ops ۱ (شامل مثبت کاذب‌هایی مثل #add-break)
  const HEX = /(?<![\w&/#-])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3})(?![\w-])/g;
  const found = [];
  for (const f of JS_FILES) {
    const src = read(`public-admin/js/${f}`);
    for (const m of src.matchAll(HEX)) found.push(`${f}: ${m[0]}`);
    for (const m of src.matchAll(/rgba?\(/g)) found.push(`${f}: ${m[0]}`);
    for (const m of src.matchAll(/\b(?:stop-color|fill|stroke)=\\?"(?!none|currentColor|url|var)[^"]+"/g)) found.push(`${f}: ${m[0]}`);
  }
  test('هیچ رنگ سخت‌کدی در JSها نیست (فهرست مجاز خالی است)', () => {
    assert.deepEqual(found, []);
  });
  test('تعداد از حدّ پایه‌ی ممیزی T1 بیشتر نمی‌شود', () => {
    assert.ok(found.length <= BASELINE_JS, `${found.length} > ${BASELINE_JS}`);
  });
  test('style="" درون‌خطی رنگی با مقدار خام وجود ندارد (فقط var(--…) / inherit)', () => {
    const bad = [];
    for (const f of JS_FILES) {
      for (const m of read(`public-admin/js/${f}`).matchAll(/style=\\?"([^"]*)"/g)) {
        if (/(?:color|background|border|outline|fill|stroke)\s*:\s*(?!var\(--|inherit|transparent|none|currentColor)[^;"]+/i.test(m[1])) bad.push(`${f}: ${m[1]}`);
      }
    }
    assert.deepEqual(bad, []);
  });
});

// ---------- ۲) ممیزی رنگ سخت‌کد در style.css (بیرون از توکن‌ها و چاپ) ----------
describe('T7: رنگ سخت‌کد در style.css (غیرِ چاپ)', () => {
  const lits = [];
  for (const r of RULES) {
    for (const d of r.body.split(';')) {
      const i = d.indexOf(':'); if (i < 0) continue;
      const prop = d.slice(0, i).trim(); const val = d.slice(i + 1);
      if (prop.startsWith('--')) continue;
      if (/#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(val)) lits.push({ sel: r.sels.join(','), prop, val: val.trim(), body: r.body });
    }
  }
  const SCRIM = /^rgba\((?:23, ?20, ?58|10, ?10, ?20|0, ?0, ?0), ?[\d.]+\)/;
  test('فقط «سفید روی --red-solid» و پرده/سایه‌ی تیره‌ی برند مجازند', () => {
    for (const l of lits) {
      const okWhite = l.prop === 'color' && /^#fff$/i.test(l.val) && /var\(--red-solid\)/.test(l.body);
      const okScrim = /^(?:background|box-shadow)$/.test(l.prop) && (SCRIM.test(l.val) || /(?:^|\s)rgba\((?:0, ?0, ?0|10, ?10, ?20)/.test(l.val));
      assert.ok(okWhite || okScrim, `رنگ سخت‌کدِ غیرمجاز: ${l.sel} { ${l.prop}: ${l.val} }`);
    }
  });
  test('تعداد مواردِ مجاز از حدّ فعلی (۷) بیشتر نمی‌شود', () => {
    assert.ok(lits.length <= 7, `${lits.length} مورد`);
  });
  test('نبودن هگز/rgba سبزِ قدیمی (#16b886 #7be495 #1fcf95 …) و نارنجی سخت‌کد (#ffa94d) خارج از توکن‌ها', () => {
    assert.doesNotMatch(SCREEN_CSS.replace(/--[\w-]+:\s*[^;]+;/g, ''), /#16b886|#7be495|#14a878|#ffa94d|rgba\(\s*(?:22, ?184, ?134|31, ?207, ?149|52, ?199, ?89)/i);
  });
});

// ---------- ۳) نمودارها ----------
describe('T7: نمودارها', () => {
  const MAIN = read('public-admin/js/views-main.js');
  const ADMIN = read('public-admin/js/views-admin.js');
  test('گرادیان #bar-green از هر دو نمودار و CSS حذف شده؛ میله‌ها از توکن CSS پر می‌شوند', () => {
    assert.doesNotMatch(MAIN + ADMIN + CSS, /bar-green|linearGradient/);
    assert.match(bodyOf('.chart .bar-a'), /fill:\s*var\(--green\)/);
    assert.match(bodyOf('.chart .pat-bg'), /fill:\s*var\(--orange\)/);
    assert.match(bodyOf('.chart .pat-ln'), /stroke:\s*var\(--card\)/);
  });
  test('«ورود با تأخیر» علاوه بر رنگ، الگوی راه‌راه دارد (هم در میله هم در افسانه)', () => {
    assert.match(MAIN, /<pattern id="bar-late"[^>]*>.*class="pat-bg".*class="pat-ln"/);
    assert.match(bodyOf('.chart .bar-b'), /fill:\s*url\(#bar-late\)/);
    assert.match(MAIN, /<i class="lg-a"><\/i>حاضر<\/span><span><i class="lg-b"><\/i>ورود با تأخیر/);
    assert.match(bodyOf('.legend .lg-a'), /var\(--green\)/);
    assert.match(bodyOf('.legend .lg-b'), /repeating-linear-gradient\([^)]*var\(--orange\)[^)]*var\(--card\)/);
  });
  const SERIES = { s0: 'brand', s1: 'orange', s2: 'blue', s3: 'teal-text', s4: 'yellow', s5: 'red' };
  test('سری‌های charts.js (تحلیل‌ها) فقط با کلاس و توکن رنگ می‌شوند؛ پالت سرمه‌ای/نارنجی/آبی/فیروزه‌ای/قرمز و بدون سبز/بنفش', () => {
    for (const [s, tok] of Object.entries(SERIES)) assert.match(CSS, new RegExp(`\\.chart \\.${s}, \\.chart-legend \\.${s} \\{ fill: var\\(--${tok}\\); stroke: var\\(--${tok}\\); \\}`));
    assert.doesNotMatch(CSS, /\.chart-legend \.s\d \{[^}]*var\(--(?:green|purple)\)/);
  });
  for (const mode of ['dark', 'light']) {
    test(`[${mode}] هر ۶ سری روی card و card-2 ≥ ۳:۱ و رنگ‌ها دو‌به‌دو متمایزند (الگوی خط/نشانگر هم دارند)`, () => {
      const v = THEMES[mode];
      const vals = Object.values(SERIES).map((k) => v[k]);
      assert.equal(new Set(vals).size, 6);
      for (const k of Object.values(SERIES)) for (const bg of ['card', 'card-2']) assert.ok(ratio(parseColor(v[k]), parseColor(v[bg])) >= 3, `${k}/${bg}`);
    });
  }
  test('انتخاب فعال کارمند در برنامه‌ی هفته‌ی بعد، لینک پرش و حباب ادمین: برند، نه سبز', () => {
    assert.match(bodyOf('.np-emp.is-active'), /var\(--brand\)[^}]*var\(--brand-soft\)/);
    assert.match(bodyOf('.skip-link'), /border: 2px solid var\(--brand\)/);
    assert.match(bodyOf('.dsp-msg.admin'), /background: var\(--brand-soft\)/);
  });
  for (const mode of ['dark', 'light']) {
    test(`[${mode}] میله‌ی حاضر/تأخیر روی کارت ≥ ۳:۱ (عنصر گرافیکی)`, () => {
      const v = THEMES[mode]; const card = parseColor(v.card);
      for (const k of ['green', 'orange']) assert.ok(ratio(over(parseColor(v[k]), card), card) >= 3, `${k}`);
      // سبز و نارنجی از نظر روشنایی نزدیک‌اند؛ تفکیک با الگوی راه‌راهِ «تأخیر» و برچسب افسانه است (تست بالا)، نه فقط رنگ.
    });
  }
});

// ---------- ۴) نمای هفتگی کارمند ----------
describe('T7: هفته‌ی کارمند (.week-grid/.day-card)', () => {
  test('امروز: --brand-soft + زیرخط نارنجی + نشانه‌ی متنیِ «امروز»', () => {
    const b = bodyOf('.day-card.is-today > summary');
    assert.match(b, /background:\s*var\(--brand-soft\)/);
    assert.match(b, /inset 0 -3px 0 var\(--accent\)/);
    assert.match(bodyOf('.day-card.is-today .day-card-date::after'), /content:\s*" · امروز"/);
  });
  test('وظیفه روی --card-2، نوار پیشرفت نارنجی، حاشیه‌ی فوری/اجباری از توکن', () => {
    assert.match(bodyOf('.day-task'), /background:\s*var\(--card-2\)/);
    assert.match(bodyOf('.day-task .rv-progress-fill'), /background:\s*var\(--accent\)/);
    assert.match(bodyOf('.day-task.is-urgent'), /outline:\s*1px solid var\(--red\)/);
    assert.match(bodyOf('.day-task.is-mandatory'), /outline:\s*1px solid var\(--green\)/);
  });
  for (const mode of ['dark', 'light']) {
    test(`[${mode}] متن/راهنمای تاریخ امروز روی سربرگِ --brand-soft و متن وظیفه روی --card-2 ≥ ۴٫۵:۱`, () => {
      const v = THEMES[mode]; const card = parseColor(v.card);
      const todayBg = over(parseColor(v['brand-soft']), card);
      for (const k of ['text', 'hint']) assert.ok(ratio(parseColor(v[k]), todayBg) >= 4.5, `${k} روی امروز`);
      const task = parseColor(v['card-2']);
      for (const k of ['text', 'hint']) assert.ok(ratio(parseColor(v[k]), task) >= 4.5, `${k} روی وظیفه`);
    });
  }
});

// ---------- ۵) تقویم تیمی و برنامه‌ی روزبه‌روز ----------
describe('T7: تقویم تیمی و برنامه‌ی روزبه‌روز', () => {
  const CAL = { present: ['green-soft', 'green'], late: ['yellow-soft', 'yellow'], incomplete: ['orange-soft', 'orange'], absent: ['red-soft', 'red'], leave: ['purple-soft', 'purple-text'], mission: ['blue-soft', 'blue'], holiday: ['ov-12', 'hint'], weekend: ['ov-04', 'hint'] };
  for (const mode of ['dark', 'light']) {
    test(`[${mode}] هر ۸ وضعیت تقویم: حرف/متن روی پس‌زمینه‌ی نرم ≥ ۴٫۵:۱`, () => {
      const v = THEMES[mode]; const card = parseColor(v.card);
      for (const [name, [bg, fg]] of Object.entries(CAL)) {
        const b = over(parseColor(v[bg]), card);
        assert.ok(ratio(parseColor(v[fg]), b) >= 4.5, `.cal-${name} (${mode}) ${ratio(parseColor(v[fg]), b).toFixed(2)}`);
      }
    });
    test(`[${mode}] برنامه‌ی روزبه‌روز: --text روی کار/تعطیل/استثنا ≥ ۴٫۵:۱ (با opacity تعطیل)`, () => {
      const v = THEMES[mode]; const card = parseColor(v.card); const text = parseColor(v.text);
      for (const bg of ['green-soft', 'orange-soft', 'red-soft']) assert.ok(ratio(text, over(parseColor(v[bg]), card)) >= 4.5, bg);
      const offBg = over(parseColor(v['ov-08']), card);
      // opacity: .75 کل سلول را با کارت ترکیب می‌کند
      const mix = (c) => over([c[0], c[1], c[2], 0.75], card);
      assert.ok(ratio(mix(text), mix(offBg)) >= 4.5, `تعطیل ${ratio(mix(text), mix(offBg)).toFixed(2)}`);
    });
  }
  test('برنامه‌ی روزبه‌روز فقط با توکن رنگ می‌شود و کلید راهنما حاشیه‌ی توکنی دارد', () => {
    assert.match(bodyOf('.sch-work'), /var\(--green-soft\)/);
    assert.match(bodyOf('.sch-off'), /var\(--ov-08\)/);
    assert.match(bodyOf('.sch-sp-work'), /var\(--orange-soft\)[^}]*var\(--orange\)/);
    assert.match(bodyOf('.sch-sp-off'), /var\(--red-soft\)[^}]*var\(--red\)/);
    assert.match(bodyOf('.sch-key'), /border:\s*1px solid var\(--hint\)/);
    assert.match(bodyOf('.cal-warn'), /border:\s*1px solid var\(--red\)/);
  });
  test('حالت‌های تقویم علاوه بر رنگ، حرف/نشانه دارند (کلاس‌های .cal-* و .cal-part)', () => {
    for (const k of Object.keys(CAL)) assert.match(CSS, new RegExp(`\\.cal-${k} \\{`));
    assert.match(bodyOf('.cal-part::after'), /border-radius:\s*50%/);
    assert.match(bodyOf('.cal-pending'), /dashed/);
  });
});

// ---------- ۶) دفترچه ----------
describe('T7: دفترچه‌ی «برنامه هفته بعد»', () => {
  const NB = read('public-admin/css/notebook.css');
  test('پالت دفترچه به توکن‌های مشترک پنل متصل است و فقط از توکن‌های طراحی شناخته‌شده استفاده می‌کند', () => {
    const used = [...NB.matchAll(/var\(--([a-z0-9-]+)/g)].map((m) => m[1]);
    assert.ok(used.length > 20, 'دفترچه از --nb-* استفاده می‌کند');
    const shared = [...new Set(used.filter((n) => !n.startsWith('nb-')))].sort();
    const allowed = new Set([...Object.keys(THEMES.dark), 'radius']);
    assert.deepEqual(shared.filter((name) => !allowed.has(name)), []);
    for (const name of ['bg', 'card', 'text', 'hint', 'border', 'brand', 'brand-soft', 'on-brand']) assert.ok(shared.includes(name), name);
  });
  test('قاب بیرونی (سرتیتر صفحه) از همان view-header پنل است', () => {
    assert.match(read('public-admin/js/views-nextplan.js'), /class="view-header"/);
  });
});

// ---------- ۷) پاک‌سازی T10 ----------
describe('T10: پاک‌سازی توکن‌های مرده', () => {
  test('توکن --sidebar (جز --sidebar-w) در هیچ CSS/JS/HTML پنل و Mini App نیست', () => {
    const files = ['public-admin/css/style.css', 'public-admin/css/datepicker.css', 'public-admin/css/print.css', 'public-admin/css/notebook.css', 'public/css/style.css', 'public/css/planner.css', 'public-admin/index.html', 'public/index.html']
      .concat(JS_FILES.map((f) => `public-admin/js/${f}`));
    for (const f of files) assert.doesNotMatch(read(f), /--sidebar(?!-w)\b/, f);
  });
});
