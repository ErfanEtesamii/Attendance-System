// روتین روزانه: تسکِ بدون تاریخ هر روزِ کاری می‌آید. برای این‌که کارمند هر هفته دوباره ننویسدش،
// روتین‌های هفته‌ی قبل (تسک‌های بدون تاریخ) به‌صورت خودکار در برنامه‌ی هفته‌ی جدید کپی می‌شوند (یک‌بار؛ idempotent).
// تسکی که کارمند از هفته‌ی جدید حذف کند دوباره برنمی‌گردد (carried_from_task_id حتی برای حذف‌شده‌ها نگه‌داری می‌شود).
const plansRepo = require('../repositories/weeklyPlanRepository');
const { addDays } = require('../utils/shiftDay');

function ensureRoutines(userId, weekStart) {
  const prev = plansRepo.findByUserWeek(userId, addDays(weekStart, -7));
  if (!prev) return 0;
  const routines = plansRepo.listTasks(prev.id).filter((t) => !t.planned_date && !t.is_system && !t.is_urgent);
  if (!routines.length) return 0;
  const cur = plansRepo.findByUserWeek(userId, weekStart);
  const existing = cur ? plansRepo.listTasks(cur.id, { includeDeleted: true }) : [];
  const carried = new Set(existing.map((t) => t.carried_from_task_id).filter(Boolean));
  const titles = new Set(existing.filter((t) => !t.planned_date).map((t) => t.title));
  const todo = routines.filter((t) => !carried.has(t.id) && !titles.has(t.title));
  if (!todo.length) return 0;
  const plan = cur || plansRepo.getOrCreate(userId, weekStart);
  for (const t of todo) {
    plansRepo.addTask(plan.id, { title: t.title, description: t.description, plannedDate: null, priority: t.priority, carriedFromTaskId: t.id });
  }
  return todo.length;
}

module.exports = { ensureRoutines };
