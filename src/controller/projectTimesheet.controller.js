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
    const { project_code, employee_id, from_date, to_date } = req.query;

    const conditions = [];
    const params = [];

    if (project_code) { conditions.push('project_code = ?'); params.push(project_code); }
    if (employee_id)  { conditions.push('employee_id = ?');  params.push(employee_id); }
    if (from_date)    { conditions.push('from_date >= ?');   params.push(from_date); }
    if (to_date)      { conditions.push('to_date <= ?');     params.push(to_date); }

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
        data: [],
      });
    }

    // Aggregate per employee
    const map = new Map();

    for (const r of rows) {
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

          // Aggregates
          from_date: r.from_date,      // earliest — updated below
          to_date: r.to_date,          // latest — updated below
          total_hours: Number(r.number_of_hours) || 0,
          entries: 1,

          // Status summary
          statuses: [r.approval_status],
          approved: r.approval_status === 'Approved' ? 1 : 0,
          pending: r.approval_status === 'Pending' ? 1 : 0,
          rejected: r.approval_status === 'Rejected' ? 1 : 0,

          // Last approval info (most recent)
          last_approved_by: r.approved_by || null,
          last_approved_on: r.approved_on || null,
        });
      } else {
        const a = map.get(key);

        // earlier from_date wins
        if (r.from_date < a.from_date) a.from_date = r.from_date;

        // later to_date wins
        if (r.to_date > a.to_date) a.to_date = r.to_date;

        // sum hours
        a.total_hours += Number(r.number_of_hours) || 0;
        a.entries += 1;

        // status counters
        if (r.approval_status === 'Approved') a.approved += 1;
        else if (r.approval_status === 'Pending') a.pending += 1;
        else if (r.approval_status === 'Rejected') a.rejected += 1;
        a.statuses.push(r.approval_status);

        // keep the most recent approval info
        if (r.approved_on && (!a.last_approved_on || r.approved_on > a.last_approved_on)) {
          a.last_approved_on = r.approved_on;
          a.last_approved_by = r.approved_by || null;
        }
      }
    }

    // finalize
    const data = [...map.values()].map((a) => {
      // overall status: Approved if all approved, Pending if any pending, etc.
      const overall =
        a.pending > 0 ? 'Pending'
        : a.rejected > 0 ? 'Rejected'
        : a.approved === a.entries ? 'Approved'
        : 'Mixed';

      // round total to 2 decimals (avoid float drift)
      a.total_hours = Math.round(a.total_hours * 100) / 100;

      return {
        ...a,
        overall_status: overall,
        statuses: undefined, // drop the raw array
      };
    });

    return res.status(200).json({
      success: true,
      projectcategory_code,
      count: data.length,
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