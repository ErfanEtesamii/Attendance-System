// عکس پروفایل: اعتبارسنجی محتوا (امضای فایل)، سقف حجم، جایگزینی/حذف، data URL.
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { Readable } = require('stream');
const { makeUser } = require('./helpers/factories');
const avatarService = require('../src/services/avatarService');

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 1)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(100, 2)]);
const stream = (buf) => Readable.from([buf]);

describe('avatarService', () => {
  let u; let other;
  before(() => { resetDb(); u = makeUser({ role: 'employee' }); other = makeUser({ role: 'employee' }); });
  after(() => cleanup());

  test('JPEG معتبر ذخیره می‌شود و data URL می‌دهد؛ کاربر دیگر چیزی نمی‌بیند', async () => {
    const r = await avatarService.save(u.id, stream(JPEG), { mime: 'image/jpeg', size: JPEG.length });
    assert.equal(r.ok, true);
    assert.match(avatarService.dataUrl(u.id), /^data:image\/jpeg;base64,/);
    assert.equal(avatarService.dataUrl(other.id), null);
  });

  test('محتوای غیرتصویری با mime جعلی رد می‌شود و فایل نیمه‌کاره نمی‌ماند', async () => {
    const before = fs.readdirSync(require('../src/config').attachmentsDir + '/avatars').length;
    const r = await avatarService.save(other.id, stream(Buffer.from('<script>alert(1)</script>')), { mime: 'image/jpeg' });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'INVALID_CONTENT');
    assert.equal(fs.readdirSync(require('../src/config').attachmentsDir + '/avatars').length, before);
  });

  test('نوع غیرمجاز و حجم زیاد رد می‌شود', async () => {
    assert.equal((await avatarService.save(u.id, stream(JPEG), { mime: 'application/pdf' })).code, 'TYPE_NOT_ALLOWED');
    assert.equal((await avatarService.save(u.id, stream(JPEG), { mime: 'image/jpeg', size: avatarService.MAX_BYTES + 1 })).code, 'TOO_LARGE');
    const big = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(avatarService.MAX_BYTES + 10)]);
    assert.equal((await avatarService.save(u.id, stream(big), { mime: 'image/jpeg' })).code, 'TOO_LARGE');
    assert.match(avatarService.dataUrl(u.id), /^data:image\/jpeg/); // عکس قبلی دست‌نخورده
  });

  test('جایگزینی فایل قبلی را پاک می‌کند؛ حذف ردیف و فایل را می‌برد', async () => {
    const first = avatarService.get(u.id).file_id;
    const r = await avatarService.save(u.id, stream(PNG), { mime: 'image/png' });
    assert.equal(r.ok, true);
    assert.equal(avatarService.get(u.id).mime, 'image/png');
    assert.equal(fs.existsSync(avatarService.pathOf(first)), false);
    const id = avatarService.get(u.id).file_id;
    assert.equal((await avatarService.remove(u.id)).removed, true);
    assert.equal(avatarService.get(u.id), null);
    assert.equal(fs.existsSync(avatarService.pathOf(id)), false);
  });

  test('pathOf فقط شناسه‌ی ۳۲ hex را می‌پذیرد (path traversal)', () => {
    assert.equal(avatarService.pathOf('../../etc/passwd'), null);
    assert.equal(avatarService.pathOf('a'.repeat(32)).endsWith('a'.repeat(32)), true);
  });
});
