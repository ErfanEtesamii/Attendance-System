// wrapper مشترک Jobهای زمان‌بندی‌شده (بخش ۲-ج۱): هر اجرا (شروع، موفق/خطا، مدت) در job_runs ثبت می‌شود.
// ثبت‌نکردن یا خطای دیتابیس هرگز نباید خود Job را مختل کند؛ و خطای Job هرگز از callback cron بیرون نمی‌زند
// (رفتار قبلی: .catch(console.error)).

const jobRunsRepository = require('../repositories/jobRunsRepository');
const { sanitizeText } = require('./sanitize');

function safe(fn) {
  try {
    return fn();
  } catch (err) {
    console.error(`[job-runner] ثبت اجرا در دیتابیس ناموفق: ${err.message}`);
    return undefined;
  }
}

/**
 * @param {string} name       نام ثابت Job (کلید config.cron)
 * @param {Function} fn       تابع sync/async؛ throw/reject = خطا
 * @param {{recordSuccess?: boolean}} [opts] recordSuccess=false: فقط شکست‌ها ثبت شوند (برای Jobهای پرتکرار مثل watchdog)
 * @returns {() => Promise<{ok:boolean, error?:string}>}
 */
function wrapJob(name, fn, { recordSuccess = true } = {}) {
  return async function runJob() {
    const startedMs = Date.now();
    const runId = recordSuccess ? safe(() => jobRunsRepository.start(name)) : undefined;
    try {
      await fn();
      if (runId !== undefined) {
        safe(() => jobRunsRepository.finish(runId, { status: 'success', durationMs: Date.now() - startedMs }));
      }
      return { ok: true };
    } catch (err) {
      const message = sanitizeText(err && err.message ? err.message : err);
      console.error(`[scheduler] ${name} error:`, message);
      const id = runId !== undefined ? runId : safe(() => jobRunsRepository.start(name));
      if (id !== undefined) {
        safe(() => jobRunsRepository.finish(id, { status: 'error', error: message, durationMs: Date.now() - startedMs }));
      }
      return { ok: false, error: message };
    }
  };
}

// چند کار مستقل زیر یک Job: همه اجرا می‌شوند حتی اگر یکی شکست بخورد؛ اگر هر کدام شکست خورده باشد خطا throw می‌شود
async function runAll(...fns) {
  const results = await Promise.allSettled(fns.map((f) => Promise.resolve().then(f)));
  const failed = results.filter((r) => r.status === 'rejected');
  if (failed.length) throw new Error(failed.map((r) => (r.reason && r.reason.message) || String(r.reason)).join(' | '));
}

module.exports = { wrapJob, runAll };
