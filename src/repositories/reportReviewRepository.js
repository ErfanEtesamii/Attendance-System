// «مشاهده شد»ِ سرپرست روی گزارش روزانه‌ی کارمند (D1). یکتا روی (reviewer, subject, date).
const { getDb } = require('../db/connection');

function find(reviewerId, subjectUserId, reportDate) {
  return getDb().prepare('SELECT * FROM report_reviews WHERE reviewer_id = ? AND subject_user_id = ? AND report_date = ?').get(reviewerId, subjectUserId, reportDate) || null;
}

function upsert({ reviewerId, subjectUserId, reportDate, comment = null, reaction = null }) {
  getDb().prepare(`INSERT INTO report_reviews (reviewer_id, subject_user_id, report_date, comment, reaction) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (reviewer_id, subject_user_id, report_date) DO UPDATE SET
      comment = COALESCE(excluded.comment, report_reviews.comment), reaction = COALESCE(excluded.reaction, report_reviews.reaction)`)
    .run(reviewerId, subjectUserId, reportDate, comment, reaction);
  return find(reviewerId, subjectUserId, reportDate);
}

function listBySubjectDate(subjectUserId, reportDate) {
  return getDb().prepare('SELECT * FROM report_reviews WHERE subject_user_id = ? AND report_date = ? ORDER BY id').all(subjectUserId, reportDate);
}

function listByReviewerDate(reviewerId, reportDate) {
  return getDb().prepare('SELECT * FROM report_reviews WHERE reviewer_id = ? AND report_date = ? ORDER BY subject_user_id').all(reviewerId, reportDate);
}

// «مشاهده شد»های یک سرپرست برای مجموعه‌ای از اعضا در یک روز (D9)
function listByReviewerSubjectsDate(reviewerId, subjectIds, reportDate) {
  if (!Array.isArray(subjectIds) || !subjectIds.length) return [];
  return getDb().prepare(`SELECT * FROM report_reviews WHERE reviewer_id = ? AND report_date = ? AND subject_user_id IN (${subjectIds.map(() => '?').join(',')}) ORDER BY subject_user_id`).all(reviewerId, reportDate, ...subjectIds);
}

module.exports = { find, upsert, listBySubjectDate, listByReviewerDate, listByReviewerSubjectsDate };
