// D3 (فاز ۱۲): تصمیم روی «درخواست اجازه‌ی ورود» + عوارضِ آن (audit، اعلان پنل/تلگرام به کارمند).
// منبع مشترک route پنل (POST /admin/checkin-permissions/:id/decide) و دکمه‌های بات (cp_ok/cp_no) تا رفتار هر دو دقیقاً یکی بماند.
// قواعد (چه کسی تصمیم می‌گیرد، فقط روی pending، TTL) در lateLimitService.decide است؛ این‌جا فقط اجرا + اثرهای جانبی.
// خروجی: { ok: true, permission } یا { ok: false, status, code, error } (بدون exception برای خطای کاربر). خطای اعلان هرگز ثبت را نمی‌شکند.
const lateLimitService = require('./lateLimitService');
const checkinPermissionRepository = require('../repositories/checkinPermissionRepository');
const auditRepository = require('../repositories/auditRepository');
const notificationEvents = require('./notificationEvents');

const auditView = (row) => (row ? { status: row.status, expires_at: row.expires_at || null, decided_by: row.decided_by || null } : null);

/**
 * @param {{id: number, role: string}} actor سرپرست مستقیم یا ادمین (hr/employee را lateLimitService.decide رد می‌کند)
 * @param {number|string} id شناسه‌ی درخواست
 * @param {boolean} approve true = اجازه، false = رد
 * @param {string|null} note یادداشت اختیاری (≤ ۲۰۰ نویسه)
 * @param {{source?: string, ip?: string|null, now?: Date}} [opts] source = admin_panel | telegram_bot
 */
function decideAndNotify(actor, id, approve, note, { source = 'admin_panel', ip = null, now = new Date() } = {}) {
  const before = checkinPermissionRepository.findById(Number(id));
  const r = lateLimitService.decide(actor, id, !!approve, note, now);
  if (!r.ok) return r;

  const row = checkinPermissionRepository.findById(r.permission.id);
  try {
    auditRepository.logChange({
      actor: actor.id,
      action: approve ? 'checkin_permission_approved' : 'checkin_permission_rejected',
      entityType: 'checkin_permission',
      entityId: r.permission.id,
      before: auditView(before),
      after: auditView(row),
      reason: r.permission.decisionNote || null,
      ip,
      meta: { source, targetUserId: r.permission.userId, permissionDate: r.permission.date, permissionId: r.permission.id },
    });
  } catch (err) {
    console.error('[checkin-permission] ثبت audit ناموفق (نادیده گرفته شد):', err && err.message ? err.message : err);
  }
  notificationEvents.checkinPermissionDecided(r.permission, { actor, note: r.permission.decisionNote }); // هرگز استثنا نمی‌دهد
  return r;
}

module.exports = { decideAndNotify };
