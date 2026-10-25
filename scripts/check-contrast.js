const fs = require('fs');
const path = require('path');

const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'tokens.css'), 'utf8');
const pairs = [['--text', '--bg'], ['--text', '--card'], ['--hint', '--card'], ['--on-accent', '--accent'], ['--on-green', '--green'], ['--on-brand', '--brand'], ['--on-accent-2', '--accent-2']];
function rgb(hex) { const m = /^#([0-9a-f]{6})$/i.exec(hex); return m ? [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255) : null; }
function luminance(hex) { const c = rgb(hex); if (!c) return null; return c.map((v) => (v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4)).reduce((a, v, i) => a + v * [0.2126, .7152, .0722][i], 0); }
function ratio(a, b) { const x = luminance(a); const y = luminance(b); return x == null || y == null ? null : (Math.max(x, y) + .05) / (Math.min(x, y) + .05); }
function tokens(block) { return Object.fromEntries([...block.matchAll(/(--[\w-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1], m[2]])); }
const dark = tokens((/:root,\s*:root\[data-theme="dark"\]\s*\{([\s\S]*?)\n\}/.exec(css) || [])[1] || '');
const light = tokens((/:root\[data-theme="light"\]\s*\{([\s\S]*?)\n\}/.exec(css) || [])[1] || '');
let failed = 0;
for (const [theme, values] of Object.entries({ dark, light })) for (const [fg, bg] of pairs) {
  const score = ratio(values[fg], values[bg]);
  if (score == null) { console.error(`${theme}: ${fg}/${bg} قابل محاسبه نیست`); failed += 1; }
  else if (score < 4.5) { console.error(`${theme}: ${fg}/${bg} = ${score.toFixed(2)} (حداقل 4.5)`); failed += 1; }
}
if (failed) process.exitCode = 1;
else console.log('contrast: همهٔ جفت‌های اصلی از AA عبور کردند.');
