// ارتقا/ساخت حساب owner (مالک سیستم) با آیدی عددی تلگرام.
// نقش owner فقط از همین مسیر (متغیر OWNER_TELEGRAM_ID هنگام بالا آمدن سرور، یا اسکریپت promote-owner) داده می‌شود؛
// از طریق پنل/بات/API هرگز نمی‌شود کسی را owner کرد یا owner را تغییر داد.
// idempotent است: اگر کاربر از قبل owner باشد هیچ تغییری نمی‌دهد.

const usersRepository = require('../repositories/usersRepository');
const auditRepository = require('../repositories/auditRepository');

/**
 * @returns {{ status: 'created'|'promoted'|'unchanged', user: object }}
 */
function ensureOwner(telegramUserId, { fullName = null, source = 'unknown' } = {}) {
  const tg = String(telegramUserId || '').trim();
  if (!/^\d+$/.test(tg)) throw new Error('آیدی تلگرام owner باید فقط عدد باشد.');

  const existing = usersRepository.findByTelegramId(tg);
  if (existing && existing.role === 'owner') {
    if (!existing.is_active) usersRepository.updateUser(existing.id, { is_active: 1 });
    return { status: 'unchanged', user: usersRepository.findById(existing.id) };
  }

  if (existing) {
    const before = { role: existing.role, manager_id: existing.manager_id };
    // owner زیر نظر هیچ سرپرستی نیست. تغییر نقش نشست‌های قبلی این کاربر را خودکار باطل می‌کند.
    const user = usersRepository.updateUser(existing.id, { role: 'owner', manager_id: null, is_active: 1 });
    auditRepository.logEvent({ userId: user.id, action: 'owner_promoted', details: { source, before } });
    return { status: 'promoted', user };
  }

  const user = usersRepository.createUser({ telegramUserId: tg, fullName: fullName || 'Owner', role: 'owner' });
  auditRepository.logEvent({ userId: user.id, action: 'owner_created', details: { source } });
  return { status: 'created', user };
}

module.exports = { ensureOwner };
