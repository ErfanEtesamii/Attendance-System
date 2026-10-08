// S4-12a: دریافت و ذخیره‌ی پیوست مرخصی در بات — نوع/حجم/محتوا، نام تصادفی روی دیسک، ثبت مرجع در leave_requests، پاک‌سازی فایل یتیم.
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Readable } = require('stream');

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(2000, 7)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(500, 1)]);
const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(300, 65)]);

describe('پیوست مرخصی (S4-12a)', () => {
  let dirPath; let svc; let leave; let session; let leaveRepo; let sick; let settingsRepo; let emp; let seq = 0;
  before(() => {
    resetDb();
    const F = require('./helpers/factories');
    const config = require('../src/config');
    dirPath = fs.mkdtempSync(path.join(os.tmpdir(), 'att-'));
    config.attachmentsDir = dirPath;
    svc = require('../src/services/attachmentService');
    leave = require('../src/bot/commands/leave');
    session = require('../src/bot/session');
    leaveRepo = require('../src/repositories/leaveRepository');
    settingsRepo = require('../src/repositories/settingsRepository');
    sick = require('../src/repositories/leaveTypesRepository').createLeaveType({ code: 'sick_att', title: 'استعلاجی', kind: 'leave', isPaid: true, requiresAttachment: true, countsAgainstBalance: false, allowedUnits: ['day'], maxConsecutiveDays: null, isActive: true });
    emp = F.makeUser();
  });
  after(() => { fs.rmSync(dirPath, { recursive: true, force: true }); cleanup(); });

  const files = () => fs.readdirSync(dirPath);
  const rs = (buf) => Readable.from([buf]);

  test('saveStream: JPEG/PNG/PDF ذخیره با نام تصادفی ۳۲ hex (نه نام اصلی)، نوع از محتوا، نام نمایشی پاک‌سازی‌شده', async () => {
    const r = await svc.saveStream(rs(JPEG), { mime: 'image/jpeg', size: JPEG.length, originalName: '../../etc/passwd<b>.jpg' });
    assert.equal(r.ok, true);
    assert.match(r.attachment.id, /^[0-9a-f]{32}$/);
    assert.deepEqual([r.attachment.mime, r.attachment.size], ['image/jpeg', JPEG.length]);
    assert.ok(!/[\\/]/.test(r.attachment.name) && !r.attachment.name.includes('<'));
    assert.deepEqual(files(), [r.attachment.id]);
    assert.ok(fs.readFileSync(svc.pathOf(r.attachment.id)).equals(JPEG));
    assert.equal((await svc.saveStream(rs(PNG), { mime: 'image/png' })).attachment.mime, 'image/png');
    assert.equal((await svc.saveStream(rs(PDF), { mime: 'application/pdf' })).attachment.mime, 'application/pdf');
    assert.equal(files().length, 3);
    for (const f of files()) await svc.remove(f);
    assert.deepEqual(files(), []);
  });

  test('رد: نوع غیرمجاز، حجم زیاد (ادعا و واقعیت)، محتوای جعلی/خالی، خطای دانلود — بدون فایل باقی‌مانده', async () => {
    assert.equal((await svc.saveStream(rs(JPEG), { mime: 'text/plain' })).code, 'TYPE_NOT_ALLOWED');
    assert.equal(svc.precheck({ mime: 'image/jpeg', size: 6 * 1024 * 1024 }).code, 'TOO_LARGE');
    const fake = await svc.saveStream(rs(Buffer.from('<script>alert(1)</script>')), { mime: 'application/pdf' });
    assert.equal(fake.code, 'INVALID_CONTENT');
    assert.equal((await svc.saveStream(rs(Buffer.alloc(0)), { mime: 'image/png' })).code, 'INVALID_CONTENT');
    settingsRepo.setValue('leaveAttachmentMaxKb', 16);
    const big = await svc.saveStream(rs(Buffer.concat([JPEG, Buffer.alloc(20000)])), { mime: 'image/jpeg' }); // ادعای حجم نداده؛ واقعیت بزرگ‌تر از ۱۶KB
    assert.equal(big.code, 'TOO_LARGE');
    settingsRepo.resetValue('leaveAttachmentMaxKb');
    const broken = new Readable({ read() { this.destroy(new Error('network')); } });
    assert.equal((await svc.saveStream(broken, { mime: 'image/jpeg' })).code, 'DOWNLOAD_FAILED');
    assert.deepEqual(files(), [], 'هیچ فایل یا .part باقی نماند');
    settingsRepo.setValue('leaveAttachmentTypes', 'application/pdf');
    assert.equal(svc.precheck({ mime: 'image/jpeg' }).code, 'TYPE_NOT_ALLOWED');
    settingsRepo.resetValue('leaveAttachmentTypes');
  });

  test('pathOf: فقط شناسه‌ی معتبر؛ traversal و ورودی عجیب ⇒ null', () => {
    for (const bad of ['../x', '..\\x', 'abc', '', null, undefined, 'g'.repeat(32), `${'a'.repeat(31)}/`, `${'0'.repeat(32)}.part`]) assert.equal(svc.pathOf(bad), null, String(bad));
    const id = '0123456789abcdef0123456789abcdef';
    assert.equal(svc.pathOf(id), path.join(dirPath, id));
  });

  // ---- جریان بات ----
  const mockBot = (stream) => ({ sent: [], async sendMessage(c, t, o) { this.sent.push({ c, t, o }); return true; }, async answerCallbackQuery() { return true; }, getFileStream: () => stream() });
  const last = (b) => b.sent[b.sent.length - 1];
  async function toAttachmentStep(bot, date) {
    seq += 1;
    const c = 9100 + seq;
    session.start(c, 'leave', { userId: emp.id });
    const press = (d) => leave.handleLeaveCallback(bot, { id: 'q', data: d, message: { chat: { id: c } } }, session.get(c));
    const say = (t) => leave.handleLeaveText(bot, { chat: { id: c }, text: t }, session.get(c));
    await press(`leave_type:${sick.id}`);
    await say(date);
    await say(date);
    await say('گواهی پزشک');
    return { c, press, say };
  }

  test('بات: نوع دارای پیوست الزامی ⇒ مرحله‌ی پیوست؛ متن جای فایل یادآوری می‌شود؛ نوع/حجم نامعتبر رد و مرحله می‌ماند', async () => {
    const bot = mockBot(() => rs(JPEG));
    const { c, say } = await toAttachmentStep(bot, '2028-03-04');
    assert.match(last(bot).t, /پیوست لازم دارد/);
    assert.equal(session.get(c).step, 9);
    await say('بعداً می‌فرستم');
    assert.match(last(bot).t, /عکس یا فایل PDF/);
    await leave.handleLeaveAttachment(bot, { chat: { id: c }, document: { file_id: 'f1', mime_type: 'text/plain', file_size: 10, file_name: 'a.txt' } }, session.get(c));
    assert.match(last(bot).t, /نوع فایل مجاز نیست/);
    await leave.handleLeaveAttachment(bot, { chat: { id: c }, document: { file_id: 'f2', mime_type: 'application/pdf', file_size: 50 * 1024 * 1024, file_name: 'big.pdf' } }, session.get(c));
    assert.match(last(bot).t, /بیشتر از/);
    assert.equal(session.get(c).step, 9);
    assert.deepEqual(files(), []);
    session.clear(c);
  });

  test('بات: عکس معتبر ⇒ خلاصه با پیوست ⇒ تأیید ⇒ مرجع در leave_requests و فایل با نام تصادفی؛ لغو فایل را پاک می‌کند', async () => {
    const bot = mockBot(() => rs(JPEG));
    const { c, press } = await toAttachmentStep(bot, '2028-03-05');
    await leave.handleLeaveAttachment(bot, { chat: { id: c }, photo: [{ file_id: 'small', file_size: 100 }, { file_id: 'large', file_size: JPEG.length }] }, session.get(c));
    assert.match(last(bot).t, /پیوست: ✅/);
    assert.equal(files().length, 1);
    await press('leave_confirm:yes');
    const row = leaveRepo.listByUser(emp.id).find((r) => r.start_date === '2028-03-05');
    assert.match(row.attachment_id, /^[0-9a-f]{32}$/);
    assert.deepEqual([row.attachment_mime, row.attachment_size, row.status], ['image/jpeg', JPEG.length, 'pending']);
    assert.deepEqual(files(), [row.attachment_id]);

    const bot2 = mockBot(() => rs(PDF));
    const s2 = await toAttachmentStep(bot2, '2028-03-06');
    await leave.handleLeaveAttachment(bot2, { chat: { id: s2.c }, document: { file_id: 'd', mime_type: 'application/pdf', file_size: PDF.length, file_name: 'گواهی.pdf' } }, session.get(s2.c));
    assert.equal(files().length, 2);
    await s2.press('leave_confirm:no');
    assert.deepEqual(files(), [row.attachment_id], 'لغو ⇒ فایل یتیم پاک شد');
  });

  test('قواعد سرویس: بدون پیوست ⇒ ATTACHMENT_REQUIRED؛ skip:attachment (ثبت مدیر) معاف؛ ثبت ناموفق بعد از دریافت ⇒ فایل پاک می‌شود', async () => {
    const leaveService = require('../src/services/leaveService');
    const input = { userId: emp.id, leaveTypeId: sick.id, startDate: '2028-04-04', endDate: '2028-04-04' };
    assert.deepEqual(leaveService.validate(input).errors.map((e) => e.code), ['ATTACHMENT_REQUIRED']);
    assert.equal(leaveService.validate(input, { skip: ['attachment'] }).ok, true);
    assert.equal(leaveService.validate({ ...input, attachment: { id: 'x'.repeat(32), mime: 'image/png', size: 1 } }).ok, true);

    // تداخل با درخواستِ همان روز ⇒ خلاصه رد می‌شود و فایل تازه پاک می‌شود
    const before = files().length;
    leaveService.create({ ...input, startDate: '2028-04-11', endDate: '2028-04-11' }, { skip: ['attachment'] });
    const bot = mockBot(() => rs(JPEG));
    const { c } = await toAttachmentStep(bot, '2028-04-11');
    await leave.handleLeaveAttachment(bot, { chat: { id: c }, photo: [{ file_id: 'p', file_size: JPEG.length }] }, session.get(c));
    assert.match(last(bot).t, /قابل ثبت نیست/);
    assert.equal(files().length, before);
    assert.equal(session.get(c), null);
  });
});
