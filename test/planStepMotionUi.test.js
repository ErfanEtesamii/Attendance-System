// برنامه‌ی هفتگی در Mini App: کارت مستقل برای هر تسک + حرکت ورود/خروج (هم‌خانواده‌ی «کار خارج از برنامه») — بررسی ایستا روی سورس و CSS.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
const app = read('public/js/app.js');
const css = read('public/css/style.css');
const MARK = '/* برنامه‌ی هفتگی: هر تسک یک کارت مستقل';
const block = css.slice(css.indexOf(MARK));
const render = app.slice(app.indexOf('function renderPlan()'), app.indexOf('const planBack'));

describe('حرکت و جداسازی برنامه‌ی هفتگی', () => {
  test('CSS: کی‌فریم‌های ورود/خروج/تپش/مرحله و خاموشی با reduced-motion', () => {
    assert.ok(block.length > 1500);
    for (const k of ['pl-task-in', 'pl-task-out', 'pl-day-pulse', 'pl-step-in']) assert.match(block, new RegExp(`@keyframes ${k}`));
    assert.match(block, /prefers-reduced-motion: reduce\) \{[^}]*\.day-task-edit\.is-entering[^}]*animation: none/);
  });

  test('CSS: بدون outline:none، بدون ویژگی فیزیکی چپ/راست؛ حلقه‌ی فوکوس سراسری می‌ماند', () => {
    assert.doesNotMatch(block, /outline:\s*none/);
    assert.doesNotMatch(block, /(^|[\s;{])(left|right)\s*:|margin-(left|right)|padding-(left|right)|border-(left|right)|text-align:\s*(left|right)|float:/);
  });

  test('CSS: هر تسک کارت جدا با نشانگر رنگ روز؛ حذف همچنان ≥ ۴۴px', () => {
    assert.match(block, /\.day-list-edit > \.day-task \{[^}]*border-radius: 14px/);
    assert.match(block, /\.day-list-edit > \.day-task-edit \{[^}]*var\(--pl-c/);
    assert.match(css, /\.day-task-del \{[^}]*min-height: 44px/);
  });

  test('JS: تسک تازه (چیپ، کپی هفته‌ی قبل، بازگشت از صفحه‌ی تسک) علامت می‌خورد و بعد از ساخت کارت‌ها مصرف می‌شود', () => {
    assert.match(render, /const pushFresh = \(t\) => \{ planUi\.tasks\.push\(t\); planUi\.fresh\.add\(t\);/);
    assert.equal((render.match(/pushFresh\(/g) || []).length, 2); // چیپ + کپی هفته‌ی قبل؛ افزودن از فیلد به صفحه‌ی تک‌تسک می‌رود
    assert.match(render, /planUi\.fresh\.clear\(\);[^\n]*\n\s*body\.appendChild\(planEl\('div', \{ class: 'pl-board' \}/);
    assert.match(render, /is-entering/);
    assert.match(render, /is-pulse/);
  });

  test('JS: حذفِ نرم با reduced-motion و نبودِ getAnimations بی‌تأخیر است؛ حذف با خود تسک (نه اندیس قدیمی)', () => {
    const fn = render.slice(render.indexOf('const removeTask'), render.indexOf('const dayCard'));
    assert.match(fn, /prefers-reduced-motion: reduce/);
    assert.match(fn, /typeof row\.getAnimations !== 'function'/);
    assert.match(fn, /planUi\.tasks\.indexOf\(t\)/);
    assert.match(fn, /planUi\.focus = key/);
  });

  test('JS: انیمیشن ورود مرحله فقط با تغییر مرحله/هفته؛ openPlanWizard آن را ریست می‌کند', () => {
    assert.match(render, /body\.classList\.toggle\('pl-step-anim', planUi\.shown !== stageKey\)/);
    const open = app.slice(app.indexOf('async function openPlanWizard('), app.indexOf('function renderPlan()'));
    assert.match(open, /planUi\.fresh\.clear\(\); planUi\.shown = '';/);
  });
});
