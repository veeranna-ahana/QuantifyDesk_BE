const { query } = require('../config/db');
const { runHrmsSync } = require('../../services/hrmsSyncService');
// ─────────────────────────────────────────────────────────────────────────────
// POST /api/hrms/sync-timesheets  (manual trigger — same as cron)
// ─────────────────────────────────────────────────────────────────────────────
const syncHrmsTimesheets = async (req, res) => {
  try {
    const projectCodes = req.body?.projectCodes;
    const result = await runHrmsSync(projectCodes);

    return res.status(200).json({ success: true, ...result });
  } catch (err) {
    console.error('❌ syncHrmsTimesheets error:', err.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to sync HRMS timesheets',
      error: err.message,
    });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/hrms/timesheets  (read back what's stored)
// ─────────────────────────────────────────────────────────────────────────────
const getHrmsTimesheets = async (req, res) => {
  try {
    const { project_code, projectcategory_code, employee_id, from_date, to_date } = req.query;

    const conditions = [];
    const params = [];

    if (project_code)         { conditions.push('project_code = ?');         params.push(project_code); }
    if (projectcategory_code) { conditions.push('projectcategory_code = ?'); params.push(projectcategory_code); }
    if (employee_id)          { conditions.push('employee_id = ?');          params.push(employee_id); }
    if (from_date)            { conditions.push('from_date >= ?');           params.push(from_date); }
    if (to_date)              { conditions.push('to_date <= ?');             params.push(to_date); }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const rows = await query(
      `SELECT * FROM hrms_timesheet ${where} ORDER BY from_date DESC, employee_name LIMIT 1000`,
      params
    );

    return res.status(200).json({ success: true, count: rows.length, data: rows });
  } catch (err) {
    console.error('❌ getHrmsTimesheets error:', err.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to load HRMS timesheets',
      error: err.message,
    });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/hrms/timesheets-by-category-grouped?projectcategory_code=NBD3011
// Same filter as timesheets-by-category, but rolls up each employee's rows
// into a single object with aggregated dates and hours.
// ─────────────────────────────────────────────────────────────────────────────
const getCategoryTimesheetsGroupedByEmployee = async (req, res) => {
  try {
    const { projectcategory_code } = req.query;

    if (!projectcategory_code) {
      return res.status(400).json({
        success: false,
        message: 'projectcategory_code is required',
      });
    }

    const rows = await query(
      `SELECT *
         FROM hrms_timesheet
        WHERE projectcategory_code = ?
        ORDER BY employee_id, from_date`,
      [projectcategory_code]
    );

    if (rows.length === 0) {
      return res.status(200).json({
        success: true,
        projectcategory_code,
        count: 0,
          total_hours: 0,
          approved_hours: 0,
          pending_hours: 0,
          rejected_hours: 0,
          total_entries: 0,
          total_employees: 0,
        data: [],
      });
    }

    // ─── Aggregation accumulators ──────────────────────────────────────────
    const map = new Map();

    let grandTotalHours = 0;
    let grandApprovedHours = 0;
    let grandPendingHours = 0;
    let grandRejectedHours = 0;
    let grandTotalEntries = 0;

    for (const r of rows) {
      const hours = Number(r.number_of_hours) || 0;
      const status = (r.approval_status || '').trim();

      // Grand totals across all rows
      grandTotalHours += hours;
      grandTotalEntries += 1;

      if (status === 'Approved') grandApprovedHours += hours;
      else if (status === 'Pending') grandPendingHours += hours;
      else if (status === 'Rejected') grandRejectedHours += hours;

      // ─── Per-employee aggregation (unchanged logic) ───
      const key = r.employee_id;

      if (!map.has(key)) {
        map.set(key, {
          employee_id: r.employee_id,
          employee_name: r.employee_name,
          designation: r.designation,
          department: r.department,
          employee_email: r.employee_email,
          employee_phone: r.employee_phone,
          reporting_manager: r.reporting_manager,
          employment_type: r.employment_type,

          project_code: r.project_code,
          project_name: r.project_name,
          projectcategory_code: r.projectcategory_code,
          projectcategory_name: r.projectcategory_name,

          from_date: r.from_date,
          to_date: r.to_date,
          total_hours: hours,
          approved_hours: status === 'Approved' ? hours : 0,
          pending_hours: status === 'Pending' ? hours : 0,
          rejected_hours: status === 'Rejected' ? hours : 0,
          entries: 1,

          approved: status === 'Approved' ? 1 : 0,
          pending: status === 'Pending' ? 1 : 0,
          rejected: status === 'Rejected' ? 1 : 0,
          last_submitted_on: r.submitted_on || null,
          last_approved_by: r.approved_by || null,
          last_approved_on: r.approved_on || null,
        });
      } else {
        const a = map.get(key);

        if (r.from_date < a.from_date) a.from_date = r.from_date;
        if (r.to_date > a.to_date) a.to_date = r.to_date;

        a.total_hours += hours;
        a.entries += 1;

        if (status === 'Approved') {
          a.approved += 1;
          a.approved_hours += hours;
        } else if (status === 'Pending') {
          a.pending += 1;
          a.pending_hours += hours;
        } else if (status === 'Rejected') {
          a.rejected += 1;
          a.rejected_hours += hours;
        }
        // keep the most recent submitted_on
if (r.submitted_on && (!a.last_submitted_on || r.submitted_on > a.last_submitted_on)) {
  a.last_submitted_on = r.submitted_on;
}

        if (r.approved_on && (!a.last_approved_on || r.approved_on > a.last_approved_on)) {
          a.last_approved_on = r.approved_on;
          a.last_approved_by = r.approved_by || null;
        }
      }
    }

    // ─── Finalize per-employee rows ────────────────────────────────────────
    const round2 = (n) => Math.round(n * 100) / 100;

    const data = [...map.values()].map((a) => {
      const overall =
        a.pending > 0 ? 'Pending'
        : a.rejected > 0 ? 'Rejected'
        : a.approved === a.entries ? 'Approved'
        : 'Mixed';

      return {
        ...a,
        total_hours: round2(a.total_hours),
        approved_hours: round2(a.approved_hours),
        pending_hours: round2(a.pending_hours),
        rejected_hours: round2(a.rejected_hours),
        overall_status: overall,
      };
    });

    // ─── Response ──────────────────────────────────────────────────────────
    return res.status(200).json({
      success: true,
      projectcategory_code,
      count: data.length,

      // ✅ NEW: category-level totals
      
        total_hours: round2(grandTotalHours),
        approved_hours: round2(grandApprovedHours),
        pending_hours: round2(grandPendingHours),
        rejected_hours: round2(grandRejectedHours),
        total_entries: grandTotalEntries,
        total_employees: data.length,
    

      data,
    });
  } catch (err) {
    console.error('❌ getCategoryTimesheetsGroupedByEmployee error:', err.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to load grouped timesheets by category',
      error: err.message,
    });
  }
};

module.exports = { syncHrmsTimesheets, getHrmsTimesheets,  getCategoryTimesheetsGroupedByEmployee, };