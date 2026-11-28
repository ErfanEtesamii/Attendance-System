// هدف فروش ماهانه‌ی کارمند (جدول sales_targets). فقط دسترسی به داده؛ قواعد مجوز در commissionService.
const { getDb } = require('../db/connection');

const find = (userId, jy, jm) => getDb().prepare('SELECT * FROM sales_targets WHERE user_id = ? AND jy = ? AND jm = ?').get(userId, jy, jm) || null;

/** ایجاد/ویرایش؛ با تغییر مبلغ هدف، علامت «اعلان رسیدن به هدف» پاک می‌شود تا هدف جدید دوباره اعلام شود. */
function upsert({ userId, jy, jm, targetToman, rewardToman, rewardNote, setBy }) {
  const db = getDb();
  const prev = find(userId, jy, jm);
  if (prev) {
    const reset = prev.target_toman !== targetToman ? ', achieved_notified_at = NULL' : '';
    db.prepare(`UPDATE sales_targets SET target_toman = ?, reward_toman = ?, reward_note = ?, set_by = ?, updated_at = datetime('now')${reset} WHERE id = ?`)
      .run(targetToman, rewardToman, rewardNote || null, setBy || null, prev.id);
  } else {
    db.prepare('INSERT INTO sales_targets (user_id, jy, jm, target_toman, reward_toman, reward_note, set_by) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(userId, jy, jm, targetToman, rewardToman, rewardNote || null, setBy || null);
  }
  return { before: prev, after: find(userId, jy, jm) };
}

function remove(userId, jy, jm) {
  const prev = find(userId, jy, jm);
  if (prev) getDb().prepare('DELETE FROM sales_targets WHERE id = ?').run(prev.id);
  return prev;
}

const listForMonth = (jy, jm) => getDb().prepare('SELECT * FROM sales_targets WHERE jy = ? AND jm = ?').all(jy, jm);
const markNotified = (id) => getDb().prepare("UPDATE sales_targets SET achieved_notified_at = datetime('now') WHERE id = ?").run(id);

module.exports = { find, upsert, remove, listForMonth, markNotified };
