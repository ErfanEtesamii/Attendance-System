// زنجیره‌ی تأیید مرخصی (S4-11a). SQL فقط اینجا؛ منطق در leaveApprovalService.
const { getDb } = require('../db/connection');

const toRow = (r) => ({ id: r.id, leaveRequestId: r.leave_request_id, step: r.step, approverRole: r.approver_role, status: r.status, decidedBy: r.decided_by, decidedAt: r.decided_at, note: r.note });

function listByRequest(requestId) {
  return getDb().prepare('SELECT * FROM leave_approvals WHERE leave_request_id = ? ORDER BY step').all(requestId).map(toRow);
}

function deleteByRequest(requestId) {
  getDb().prepare('DELETE FROM leave_approvals WHERE leave_request_id = ?').run(requestId);
}

function insertSteps(requestId, roles) {
  const ins = getDb().prepare('INSERT INTO leave_approvals (leave_request_id, step, approver_role) VALUES (?, ?, ?)');
  roles.forEach((role, i) => ins.run(requestId, i + 1, role));
}

function decideStep(requestId, step, status, decidedBy, note) {
  getDb()
    .prepare("UPDATE leave_approvals SET status = ?, decided_by = ?, decided_at = datetime('now'), note = ? WHERE leave_request_id = ? AND step = ?")
    .run(status, decidedBy, note || null, requestId, step);
}

function setCurrentStep(requestId, step) {
  getDb().prepare('UPDATE leave_requests SET current_step = ? WHERE id = ?').run(step, requestId);
}

// ارجاع (S4-11c): نقش تأییدکننده‌ی یک مرحله‌ی «در انتظار» عوض می‌شود
function setApproverRole(requestId, step, role) {
  getDb().prepare("UPDATE leave_approvals SET approver_role = ? WHERE leave_request_id = ? AND step = ? AND status = 'pending'").run(role, requestId, step);
}

module.exports = { listByRequest, deleteByRequest, insertSteps, decideStep, setCurrentStep, setApproverRole };
