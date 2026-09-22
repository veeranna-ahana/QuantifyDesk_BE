const { query } = require('../src/config/db');
const { getHrmsToken, fetchTimesheetForProject } = require('./hrmsService');
const { normalizeHrmsTimesheet } = require('../helpers/hrmsHelper');

// ─────────────────────────────────────────────────────────────────────────────
// Concurrency-limited runner
// ─────────────────────────────────────────────────────────────────────────────
async function runWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let index = 0;

  async function next() {
    const i = index++;
    if (i >= items.length) return;
    try {
      results[i] = await worker(items[i], i);
    } catch (err) {
      results[i] = { error: err.message, item: items[i] };
    }
    return next();
  }

  const runners = Array.from({ length: Math.min(limit, items.length) }, next);
  await Promise.all(runners);
  return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// Upsert rows into hrms_timesheet
// ─────────────────────────────────────────────────────────────────────────────
async function upsertTimesheetRows(rows) {
  if (!rows.length) return { inserted: 0, updated: 0, skipped: 0, unchanged: 0 };

  const valid = rows.filter(
    (r) => r.employee_id && r.project_code && r.from_date && r.to_date
  );
  const skipped = rows.length - valid.length;
  if (!valid.length) return { inserted: 0, updated: 0, skipped, unchanged: 0 };

  const pool = require('../src/config/db').quantifyPool;

  const dstr = (v) => {
    if (!v) return '';
    if (v instanceof Date) {
      const y = v.getFullYear();
      const m = String(v.getMonth() + 1).padStart(2, '0');
      const d = String(v.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }
    return String(v).slice(0, 10);
  };

  const numstr = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n.toFixed(2) : '0.00';
  };

  const keyOf = (r) =>
    [
      String(r.employee_id ?? '').trim(),
      String(r.project_code ?? '').trim(),
      String(r.projectcategory_code ?? '').trim(),
      dstr(r.from_date),
      dstr(r.to_date),
      numstr(r.number_of_hours),
    ].join('|');

  const projectCodes = [...new Set(valid.map((r) => r.project_code))];
  const placeholders = projectCodes.map(() => '?').join(',');

  const [existingRows] = await pool.query(
    `SELECT employee_id, project_code, projectcategory_code,
            from_date, to_date, number_of_hours,
            approval_status, approved_by, submitted_on, approved_on, remarks
       FROM hrms_timesheet
      WHERE project_code IN (${placeholders})`,
    projectCodes
  );

  const existingMap = new Map();
  for (const r of existingRows) existingMap.set(keyOf(r), r);

  let inserted = 0;
  let updated = 0;
  let unchanged = 0;

  for (const r of valid) {
    const prev = existingMap.get(keyOf(r));
    if (!prev) {
      inserted++;
      continue;
    }
    const changed =
      (prev.approval_status ?? '') !== (r.approval_status ?? '') ||
      (prev.approved_by ?? '')     !== (r.approved_by ?? '') ||
      dstr(prev.submitted_on)      !== dstr(r.submitted_on) ||
      dstr(prev.approved_on)       !== dstr(r.approved_on) ||
      (prev.remarks ?? '')         !== (r.remarks ?? '');

    if (changed) updated++;
    else unchanged++;
  }

  const values = valid.map((r) => [
    r.employee_id, r.employee_name, r.designation, r.department, r.employee_email,
    r.employee_phone, r.reporting_manager, r.employment_type,
    r.project_code, r.project_name, r.projectcategory_code, r.projectcategory_name,
    r.from_date, r.to_date, r.number_of_hours,
    r.approval_status, r.approved_by, r.submitted_on, r.approved_on, r.remarks,
  ]);

  const sql = `
    INSERT INTO hrms_timesheet (
      employee_id, employee_name, designation, department, employee_email,
      employee_phone, reporting_manager, employment_type,
      project_code, project_name, projectcategory_code, projectcategory_name,
      from_date, to_date, number_of_hours,
      approval_status, approved_by, submitted_on, approved_on, remarks
    ) VALUES ?
    ON DUPLICATE KEY UPDATE
      approval_status = VALUES(approval_status),
      approved_by     = VALUES(approved_by),
      submitted_on    = VALUES(submitted_on),
      approved_on     = VALUES(approved_on),
      remarks         = VALUES(remarks)
  `;

  await pool.query(sql, [values]);

  return { inserted, updated, skipped, unchanged };
}

// ─────────────────────────────────────────────────────────────────────────────
// The main sync — NO req/res. Pure business logic.
// Called by cron AND by the HTTP route.
// ─────────────────────────────────────────────────────────────────────────────
async function runHrmsSync(projectCodes = null) {
  let codes = projectCodes;

  if (!Array.isArray(codes) || codes.length === 0) {
    const rows = await query(
      `SELECT project_code FROM hrms_project_codes WHERE is_active = 1 ORDER BY id`
    );
    codes = rows.map((r) => r.project_code);
  }

  if (!codes.length) {
    throw new Error('No project codes found in hrms_project_codes and none provided');
  }

  console.log(`📥 HRMS sync: ${codes.length} project code(s)`);

  const results = await runWithConcurrency(codes, 3, async (code) => {
    try {
      const { token, uniqueId } = await getHrmsToken();
      const raw = await fetchTimesheetForProject(code, { token, uniqueId });
      const rows = normalizeHrmsTimesheet(raw);
      const stats = await upsertTimesheetRows(rows);

      console.log(
        `✅ ${code}: fetched ${rows.length} | inserted ${stats.inserted} | updated ${stats.updated} | unchanged ${stats.unchanged}`
      );
      return { project_code: code, fetched: rows.length, ...stats };
    } catch (err) {
      console.error(`❌ ${code}: ${err.message}`);
      return { project_code: code, error: err.message };
    }
  });

  const summary = results.reduce(
    (acc, r) => {
      if (r.error) acc.failed += 1;
      else {
        acc.succeeded += 1;
        acc.total_fetched += r.fetched || 0;
        acc.total_inserted += r.inserted || 0;
        acc.total_updated += r.updated || 0;
        acc.total_skipped += r.skipped || 0;
        acc.total_unchanged += r.unchanged || 0;
      }
      return acc;
    },
    {
      succeeded: 0,
      failed: 0,
      total_fetched: 0,
      total_inserted: 0,
      total_updated: 0,
      total_skipped: 0,
      total_unchanged: 0,
    }
  );

  return { projects_processed: codes.length, summary, results };
}

module.exports = { runHrmsSync, upsertTimesheetRows };