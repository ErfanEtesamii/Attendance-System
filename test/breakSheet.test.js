// A1/A2: دکمه‌ی «ثبت استراحت» + bottom-sheet انتخاب نوع (Mini App) و برچسب‌های هم‌خوان در بات/پنل.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8').replace(/\r\n/g, '\n');
const html = read('public/index.html');
const app = read('public/js/app.js');
const css = read('public/css/style.css');

describe('bottom-sheet ثبت استراحت (A1)', () => {
  test('سه گزینه‌ی ناهار/نماز/استراحت کوتاه با نگاشت درست به breakType', () => {
    const sheet = html.slice(html.indexOf('id="break-sheet"'), html.indexOf('id="toast"'));
    const opts = [...sheet.matchAll(/data-break-kind="(\w+)" data-break-type="(\w+)"/g)].map((m) => [m[1], m[2]]);
    assert.deepEqual(opts, [['lunch', 'lunch'], ['prayer', 'short_break'], ['short', 'short_break']]);
    assert.match(sheet, /sheet-icon[\s\S]*<svg[\s\S]*ناهار/); // فاز ۲۰: ایموجی ← آیکن SVG
    assert.match(sheet, /sheet-icon[\s\S]*<svg[\s\S]*نماز/);
    assert.match(sheet, /sheet-icon[\s\S]*<svg[\s\S]*استراحت کوتاه/);
    assert.doesNotMatch(sheet, /🍽|🕌|☕/);
    assert.match(sheet, /ناهار روی ساعت کاری اثر ثابت دارد/);
    assert.match(sheet, /id="break-sheet-cancel"[^>]*>انصراف</);
  });

  test('دسترس‌پذیری: dialog مودال با عنوان، رادیوگروپ، دکمه‌ی انصراف، بدون style/on* درون‌خطی', () => {
    const sheet = html.slice(html.indexOf('id="break-sheet"'), html.indexOf('id="toast"'));
    assert.match(sheet, /role="dialog" aria-modal="true" aria-labelledby="break-sheet-title"/);
    assert.match(sheet, /role="radiogroup"/);
    assert.doesNotMatch(sheet, /\sstyle=|\son[a-z]+=/i);
  });

  test('کاشی «ثبت استراحت / شروع وقفه» دیگر مستقیم /break/start نمی‌زند و sheet را باز می‌کند', () => {
    assert.match(app, /title: 'ثبت استراحت', sub: 'شروع وقفه'[\s\S]*?handler: \(\) => openBreakSheet\(\)/);
    assert.doesNotMatch(app, /شروع ناهار/);
    assert.match(app, /doAction\('\/break\/start', \{ breakType: btn\.dataset\.breakType \}, 'استراحت شروع شد\.'\)/);
    assert.match(app, /doAction\('\/break\/end', \{\}, 'استراحت پایان یافت\.'\)/);
  });

  test('آخرین انتخاب با localStorage داخل try/catch؛ Esc و focus-trap و بستن با لمس پس‌زمینه', () => {
    assert.match(app, /try \{\s*const v = window\.localStorage\.getItem\(BREAK_KIND_KEY\)/);
    assert.match(app, /try \{ window\.localStorage\.setItem\(BREAK_KIND_KEY, kind\); \} catch/);
    assert.match(app, /ev\.key === 'Escape'/);
    assert.match(app, /ev\.key !== 'Tab'/);
    assert.match(app, /if \(t === root\) \{ closeBreakSheet\(\); return; \}/);
  });

  test('CSS: sheet پایین صفحه، هدف لمسی ≥ ۴۴px و کاهش حرکت پوشش داده می‌شود', () => {
    assert.match(css, /\.sheet-backdrop \{[^}]*align-items: flex-end/);
    assert.match(css, /\.sheet-option \{[^}]*min-height: 56px/);
    assert.match(css, /\.sheet-cancel \{[^}]*min-height: 48px/);
  });
});

describe('برچسب‌ها (A2)', () => {
  test('بات و پنل نماز را همراه استراحت کوتاه نشان می‌دهند؛ مقدار DB و نام تنظیمات ثابت می‌ماند', () => {
    assert.match(read('src/bot/commands/status.js'), /'نماز \/ استراحت کوتاه'/);
    assert.match(read('public-admin/js/views-ops.js'), /<option value="short_break"[^>]*>نماز \/ استراحت کوتاه<\/option>/);
    assert.match(read('public-admin/js/views-shifts.js'), /maxLunchMinutes/);
  });
});

describe('ناحیه‌ی خطر ریست و epoch (B4)', () => {
  const admin = read('public-admin/js/views-admin.js');
  test('Mini App با تغییر reset_epoch state محلی را پاک می‌کند ولی device id را نه', () => {
    assert.match(app, /syncResetEpoch\(state\.me\.reset_epoch\)/);
    assert.match(app, /ls\.removeItem\(BREAK_KIND_KEY\)/);
    assert.doesNotMatch(app.slice(app.indexOf('function syncResetEpoch'), app.indexOf('let breakSheetReturnFocus')), /DEVICE_KEY/);
  });
  test('پنل: ناحیه‌ی خطر فقط با system.manage؛ دکمه‌ی نهایی تا تأیید و کد ۸ رقمی غیرفعال', () => {
    assert.match(admin, /AP\.can\('system\.manage'\)\) \{ try \{ resetOpts/);
    assert.match(admin, /id="rz-run" disabled/);
    assert.match(admin, /words\.includes\(c1\.value\.trim\(\)\) && \/\^\\d\{8\}\$\/\.test\(c2\.value\.trim\(\)\)/);
    assert.match(admin, /\/admin\/system\/reset\/preview/);
    assert.doesNotMatch(admin.slice(admin.indexOf('function resetZoneHtml'), admin.indexOf("AP.view('status'")), /\sstyle=|\bconfirm\(|\balert\(/);
  });
});
