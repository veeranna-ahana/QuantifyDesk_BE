const { query } = require("../config/db");
const { runHrmsSync } = require("../../services/hrmsSyncService");
const { fetchAllEmployeesFromHrms } = require('../../services/hrmsService');
const { pmsGet } = require("../../helpers/pmsHelper");
const { getUatToken } = require("../../helpers/pmsTokenStore");

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/hrms/sync-timesheets  (manual trigger — same as cron)
// ─────────────────────────────────────────────────────────────────────────────
const syncHrmsTimesheets = async (req, res) => {
  try {
    const projectCodes = req.body?.projectCodes;
    const result = await runHrmsSync(projectCodes);

    return res.status(200).json({ success: true, ...result });
  } catch (err) {
    console.error("❌ syncHrmsTimesheets error:", err.message);
    return res.status(500).json({
      success: false,
      message: "Failed to sync HRMS timesheets",
      error: err.message,
    });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/hrms/timesheets  (read back what's stored)
// ─────────────────────────────────────────────────────────────────────────────
const getHrmsTimesheets = async (req, res) => {
  try {
    const {
      project_code,
      projectcategory_code,
      employee_id,
      from_date,
      to_date,
    } = req.query;

    const conditions = [];
    const params = [];

    if (project_code) {
      conditions.push("project_code = ?");
      params.push(project_code);
    }
    if (projectcategory_code) {
      conditions.push("projectcategory_code = ?");
      params.push(projectcategory_code);
    }
    if (employee_id) {
      conditions.push("employee_id = ?");
      params.push(employee_id);
    }
    if (from_date) {
      conditions.push("from_date >= ?");
      params.push(from_date);
    }
    if (to_date) {
      conditions.push("to_date <= ?");
      params.push(to_date);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const rows = await query(
      `SELECT * FROM hrms_timesheet ${where} ORDER BY from_date DESC, employee_name LIMIT 1000`,
      params,
    );

    return res
      .status(200)
      .json({ success: true, count: rows.length, data: rows });
  } catch (err) {
    console.error("❌ getHrmsTimesheets error:", err.message);
    return res.status(500).json({
      success: false,
      message: "Failed to load HRMS timesheets",
      error: err.message,
    });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/hrms/timesheets-by-category-grouped?projectcategory_code=NBD3011
// Same filter as timesheets-by-category, but rolls up each employee's rows
// into a single object with aggregated dates and hours.
// ─────────────────────────────────────────────────────────────────────────────
// Extracted so callers OTHER than the HTTP route (e.g. importProject.controller.js's
// getProjectView, which needs real logged-hours per employee for Project Overview) can get the
// same grouped-by-employee HRMS data without an internal HTTP round-trip. Returns the plain data
// object the route below sends as JSON — no req/res here.
async function fetchCategoryTimesheetsGroupedByEmployee(projectcategory_code) {
  if (!projectcategory_code) {
    return {
      success: false,
      message: "projectcategory_code is required",
    };
  }

  const rows = await query(
    `SELECT *
       FROM hrms_timesheet
      WHERE projectcategory_code = ?
      ORDER BY employee_id, from_date`,
    [projectcategory_code],
  );

  if (rows.length === 0) {
    return {
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
    };
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
    const status = (r.approval_status || "").trim();

    // Grand totals across all rows
    grandTotalHours += hours;
    grandTotalEntries += 1;

    if (status === "Approved") grandApprovedHours += hours;
    else if (status === "Pending") grandPendingHours += hours;
    else if (status === "Rejected") grandRejectedHours += hours;

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
        approved_hours: status === "Approved" ? hours : 0,
        pending_hours: status === "Pending" ? hours : 0,
        rejected_hours: status === "Rejected" ? hours : 0,
        entries: 1,

        approved: status === "Approved" ? 1 : 0,
        pending: status === "Pending" ? 1 : 0,
        rejected: status === "Rejected" ? 1 : 0,
        last_submitted_on: r.submitted_on || null,
        last_approved_by: r.approved_by || null,
        last_approved_on: r.approved_on || null,
         last_entry_status: status,                       // ← ADD
        last_entire_approved_on:                          // ← ADD
          status === "Approved" ? (r.approved_on || null) : null,
      });
    } else {
      const a = map.get(key);

      if (r.from_date < a.from_date) a.from_date = r.from_date;
      if (r.to_date > a.to_date) a.to_date = r.to_date;

      a.total_hours += hours;
      a.entries += 1;

      if (status === "Approved") {
        a.approved += 1;
        a.approved_hours += hours;
      } else if (status === "Pending") {
        a.pending += 1;
        a.pending_hours += hours;
      } else if (status === "Rejected") {
        a.rejected += 1;
        a.rejected_hours += hours;
      }
      // keep the most recent submitted_on
      if (
        r.submitted_on &&
        (!a.last_submitted_on || r.submitted_on > a.last_submitted_on)
      ) {
        a.last_submitted_on = r.submitted_on;
      }

      if (
        r.approved_on &&
        (!a.last_approved_on || r.approved_on > a.last_approved_on)
      ) {
        a.last_approved_on = r.approved_on;
        a.last_approved_by = r.approved_by || null;
      }
       // ─── NEW: track the latest entry's status, and derive the
      //          "last entire approval" date from it ─────────────
      // Rows arrive ordered by from_date ASC, so r is the latest entry
      // seen so far for this employee.
      a.last_entry_status = status;
      a.last_entire_approved_on =
        status === "Approved" ? (r.approved_on || null) : null;
    }
  }

  // ─── Finalize per-employee rows ────────────────────────────────────────
  const round2 = (n) => Math.round(n * 100) / 100;

  const data = [...map.values()].map((a) => {
    const overall =
      a.pending > 0
        ? "Pending"
        : a.rejected > 0
          ? "Rejected"
          : a.approved === a.entries
            ? "Approved"
            : "Mixed";
const { last_entry_status, ...rest } = a;
    return {
      ...rest,
      total_hours: round2(a.total_hours),
      approved_hours: round2(a.approved_hours),
      pending_hours: round2(a.pending_hours),
      rejected_hours: round2(a.rejected_hours),
      overall_status: overall,
    };
  });

  // ─── Result ──────────────────────────────────────────────────────────────
  return {
    success: true,
    projectcategory_code,
    count: data.length,
    total_hours: round2(grandTotalHours),
    approved_hours: round2(grandApprovedHours),
    pending_hours: round2(grandPendingHours),
    rejected_hours: round2(grandRejectedHours),
    total_entries: grandTotalEntries,
    total_employees: data.length,
    data,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/hrms/timesheets-by-category-grouped?projectcategory_code=NBD3011
// Thin HTTP wrapper around fetchCategoryTimesheetsGroupedByEmployee above.
// ─────────────────────────────────────────────────────────────────────────────
const getCategoryTimesheetsGroupedByEmployee = async (req, res) => {
  try {
    const { projectcategory_code } = req.query;
    const result =
      await fetchCategoryTimesheetsGroupedByEmployee(projectcategory_code);
    const status = result.success === false ? 400 : 200;
    return res.status(status).json(result);
  } catch (err) {
    console.error(
      "❌ getCategoryTimesheetsGroupedByEmployee error:",
      err.message,
    );
    return res.status(500).json({
      success: false,
      message: "Failed to load grouped timesheets by category",
      error: err.message,
    });
  }
};


//Timesheet report api
const getAllCategoriesTimesheetsReport = async (req, res) => {
  try {
    const includeEmpty = String(req.query.include_empty || '').toLowerCase() === 'true';

    const rows = await query(
      `SELECT DISTINCT sub_category
         FROM project_info
        WHERE sub_category IS NOT NULL AND TRIM(sub_category) <> ''
        ORDER BY sub_category`
    );

    const categories = rows.map((r) => r.sub_category);
    const results = [];

    for (const code of categories) {
      const result = await fetchCategoryTimesheetsGroupedByEmployee(code);
      if (!includeEmpty && (result?.count ?? 0) === 0) continue;
      results.push({
        projectcategory_code: code,
        count: result?.count ?? 0,
        totals: {
          total_hours: result?.total_hours ?? 0,
          approved_hours: result?.approved_hours ?? 0,
          pending_hours: result?.pending_hours ?? 0,
          rejected_hours: result?.rejected_hours ?? 0,
          total_entries: result?.total_entries ?? 0,
          total_employees: result?.total_employees ?? 0,
        },
        data: result?.data ?? [],
      });
    }

    // Grand totals
    const grand = { total_hours: 0, approved_hours: 0, pending_hours: 0, rejected_hours: 0, total_entries: 0, total_employees: 0 };
    const empSet = new Set();
    for (const r of results) {
      grand.total_hours     += r.totals.total_hours;
      grand.approved_hours  += r.totals.approved_hours;
      grand.pending_hours   += r.totals.pending_hours;
      grand.rejected_hours  += r.totals.rejected_hours;
      grand.total_entries   += r.totals.total_entries;
      for (const e of r.data) if (e.employee_id) empSet.add(e.employee_id);
    }
    grand.total_employees = empSet.size;
    for (const k of ['total_hours','approved_hours','pending_hours','rejected_hours']) {
      grand[k] = Math.round(grand[k] * 100) / 100;
    }

    return res.status(200).json({
      success: true,
      total_categories: results.length,
      totals: grand,
      categories: results,
    });
  } catch (err) {
    console.error('❌ getAllCategoriesTimesheetsReport error:', err.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to load all-categories timesheet report',
      error: err.message,
    });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/hrms/timesheets-app-dev-designation-report
//
// Aggregates hrms_timesheet rows for every active Delivery employee whose
// designation contains "Application Development" (case-insensitive).
// ─────────────────────────────────────────────────────────────────────────────
const getAppDevDesignationTimesheetsReport = async (req, res) => {
  try {
    const includeEmpty = String(req.query.include_empty || '').toLowerCase() === 'true';

    // ─── 1. Fetch HRMS employees and filter ─────────────────────────────
    const allEmployees = await fetchAllEmployeesFromHrms();

    const matchedEmployees = allEmployees.filter((e) => {
      const dept = String(e.Name_of_Department || '').trim();
      const status = String(e.Employee_Status || '').trim().toLowerCase();
      const designation = String(e.Employee_Designation || '').toLowerCase();

      return (
        dept === 'Delivery' &&
        status === 'active' &&
        designation.includes('application development')
      );
    });

    if (matchedEmployees.length === 0) {
      return res.status(200).json({
        success: true,
        total_entries: 0,
        totals: { total_hours: 0, approved_hours: 0, pending_hours: 0, rejected_hours: 0, total_entries: 0, total_employees: 0 },
        data: [],
      });
    }

    const empIds = matchedEmployees.map((e) => e.Employee_ID).filter(Boolean);
    const placeholders = empIds.map(() => '?').join(',');

    // ─── 2. Pull timesheet rows ─────────────────────────────────────────
    const rows = await query(
      `SELECT *
         FROM hrms_timesheet
        WHERE employee_id IN (${placeholders})
        ORDER BY employee_id, projectcategory_code, from_date`,
      empIds
    );

    // Map HRMS records for metadata
    const hrmsById = new Map();
    for (const e of matchedEmployees) {
      if (e.Employee_ID) hrmsById.set(String(e.Employee_ID).trim(), e);
    }

    // ─── 3. Group by (employee_id + projectcategory_code) ───────────────
    const byProject = new Map();
    const round2 = (n) => Math.round(n * 100) / 100;

    for (const r of rows) {
      const empId = r.employee_id;
      const category = r.projectcategory_code || 'NA';
      
      // Composite key: one object per employee per category
      const key = `${empId}|${category}`;

      if (!byProject.has(key)) {
        const hrms = hrmsById.get(String(empId).trim()) || {};
        byProject.set(key, {
          employee_id: empId,
          employee_name: r.employee_name || hrms.Employee_Name || null,
          designation: hrms.Employee_Designation || null,
          department: hrms.Name_of_Department || null,
          employee_email: hrms.Employee_Official_Email_ID || null,
          employee_phone: hrms.Employee_Phone || null,
          reporting_manager: hrms.Reporting_Manager_Name || null,
          employment_type: hrms.Employment_Type || null,
          doj: hrms.DOJ || null,

          project_code: r.project_code || null,
          project_name: r.project_name || null,
          projectcategory_code: category,
          projectcategory_name: r.projectcategory_name || null,

          from_date: r.from_date,
          to_date: r.to_date,

          total_hours: 0,
          approved_hours: 0,
          pending_hours: 0,
          rejected_hours: 0,

          entries: 0,
          approved: 0,
          pending: 0,
          rejected: 0,

          last_submitted_on: r.submitted_on || null,
          last_approved_by: r.approved_by || null,
          last_approved_on: r.approved_on || null,
        });
      }

      const a = byProject.get(key);
      const hours = Number(r.number_of_hours) || 0;
      const status = (r.approval_status || '').trim();

      a.total_hours += hours;
      a.entries += 1;

      if (status === 'Approved') { a.approved += 1; a.approved_hours += hours; }
      else if (status === 'Pending') { a.pending += 1; a.pending_hours += hours; }
      else if (status === 'Rejected') { a.rejected += 1; a.rejected_hours += hours; }

      if (r.from_date && (!a.from_date || r.from_date < a.from_date)) a.from_date = r.from_date;
      if (r.to_date && (!a.to_date || r.to_date > a.to_date)) a.to_date = r.to_date;

      if (r.submitted_on && (!a.last_submitted_on || r.submitted_on > a.last_submitted_on)) {
        a.last_submitted_on = r.submitted_on;
      }
      if (r.approved_on && (!a.last_approved_on || r.approved_on > a.last_approved_on)) {
        a.last_approved_on = r.approved_on;
        a.last_approved_by = r.approved_by || null;
      }
    }

    // ─── 4. Finalize objects ────────────────────────────────────────────
    const results = [];
    for (const a of byProject.values()) {
      const overallStatus =
        a.pending > 0 ? 'Pending'
        : a.rejected > 0 ? 'Rejected'
        : a.approved === a.entries ? 'Approved'
        : 'Mixed';

      if (!includeEmpty && a.entries === 0) continue;

      results.push({
        ...a,
        total_hours: round2(a.total_hours),
        approved_hours: round2(a.approved_hours),
        pending_hours: round2(a.pending_hours),
        rejected_hours: round2(a.rejected_hours),
        overall_status: overallStatus,
      });
    }

    // Sort: Employee name first, then by total hours descending
    results.sort((a, b) => {
      const nameCompare = String(a.employee_name).localeCompare(String(b.employee_name));
      if (nameCompare !== 0) return nameCompare;
      return b.total_hours - a.total_hours;
    });

    // ─── 5. Grand totals ────────────────────────────────────────────────
    const grand = {
      total_hours: 0,
      approved_hours: 0,
      pending_hours: 0,
      rejected_hours: 0,
      total_entries: 0,
      total_employees: new Set(results.map(r => r.employee_id)).size,
    };

    for (const r of results) {
      grand.total_hours     += r.total_hours;
      grand.approved_hours  += r.approved_hours;
      grand.pending_hours   += r.pending_hours;
      grand.rejected_hours  += r.rejected_hours;
      grand.total_entries   += r.entries;
    }
    grand.total_hours     = round2(grand.total_hours);
    grand.approved_hours  = round2(grand.approved_hours);
    grand.pending_hours   = round2(grand.pending_hours);
    grand.rejected_hours  = round2(grand.rejected_hours);

    // ─── 6. Response ────────────────────────────────────────────────────
    return res.status(200).json({
      success: true,
      filter: {
        department: 'Delivery',
        status: 'Active',
        designation_contains: 'Application Development',
      },
      totals: grand,
      data: results,
    });
  } catch (err) {
    console.error('❌ getAppDevDesignationTimesheetsReport error:', err.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to load App-Dev designation timesheet report',
      error: err.message,
    });
  }
};

const getProjectWiseSummary = async (req, res) => {
  try {
    // ─── 1. Resolve Token ────────────────────────────────────────────────
    const uatToken =
      getUatToken(req.user?.emp_id) || process.env.PMS_SERVICE_TOKEN || null;

    if (!uatToken) {
      return res.status(401).json({
        success: false,
        message: 'No PMS session found. Please log in again.',
      });
    }

    // ─── 2. Fetch HRMS Employees to filter for App Dev ───────────────────
    const allEmployees = await fetchAllEmployeesFromHrms();
    
    const appDevEmpIds = allEmployees
      .filter((e) => {
        const dept = String(e.Name_of_Department || '').trim();
        const status = String(e.Employee_Status || '').trim().toLowerCase();
        const designation = String(e.Employee_Designation || '').toLowerCase();

        return (
          dept === 'Delivery' &&
          status === 'active' &&
          designation.includes('application development')
        );
      })
      .map((e) => e.Employee_ID)
      .filter(Boolean);

    if (appDevEmpIds.length === 0) {
      return res.status(200).json({
        title: 'Project wise summary (App Dev)',
        totalRecords: 0,
        projects: [],
      });
    }

    // ─── 3. Aggregate Timesheet Data (Filtered by App Dev IDs) ───────────
    const placeholders = appDevEmpIds.map(() => '?').join(',');

    const rows = await query(
      `SELECT
         projectcategory_code,
         MAX(projectcategory_name) AS projectcategory_name,
         MAX(project_code)         AS parent_project_code,
         COUNT(DISTINCT employee_id) AS member_worked,
         SUM(number_of_hours)        AS total_hours,
         MIN(from_date)              AS first_date
       FROM hrms_timesheet
       WHERE projectcategory_code IS NOT NULL
         AND TRIM(projectcategory_code) <> ''
         AND projectcategory_code <> 'NA'
         AND employee_id IN (${placeholders})  -- ✅ Filter by App Dev team
       GROUP BY projectcategory_code
       ORDER BY total_hours DESC`,
      appDevEmpIds
    );

    if (rows.length === 0) {
      return res.status(200).json({
        title: 'Project wise summary (App Dev)',
        totalRecords: 0,
        projects: [],
      });
    }

    // ─── 4. Fetch PMS Projects for customer_name ─────────────────────────
    let pmsProjects = [];
    try {
      const rawPms = await pmsGet(uatToken, '/api/pms/getAllProjects');
      pmsProjects = Array.isArray(rawPms?.projects) ? rawPms.projects : 
                    Array.isArray(rawPms?.data?.projects) ? rawPms.data.projects : [];
    } catch (err) {
      console.warn('⚠️ PMS getAllProjects failed, customer_name will be null:', err.message);
    }

    // ─── 5. Merge and Format ─────────────────────────────────────────────
    const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    
    const projects = rows.map((r) => {
      const code = r.projectcategory_code;
      const hrmsName = String(r.projectcategory_name || '').toLowerCase();

      // Customer name matching logic (from previous step)
      const pmsProj = pmsProjects.find((p) => {
        if (!p.project_title) return false;
        const title = p.project_title.toLowerCase();
        
        if (title === hrmsName) return true;
        if (title.includes(code.toLowerCase()) || hrmsName.includes(code.toLowerCase())) return true;

        const cleanTitle = title.replace(/[^a-z0-9]/g, ' ');
        const cleanHrms = hrmsName.replace(/[^a-z0-9]/g, ' ');
        if (cleanTitle.includes('work quantify') && cleanHrms.includes('work quantify')) return true;

        return false;
      });

      let firstMonthSeen = 'N/A';
      if (r.first_date) {
        const d = new Date(r.first_date);
        firstMonthSeen = monthNames[d.getMonth()];
      }

      return {
        projectCode: code,
        projectName: r.projectcategory_name,
        customerName: pmsProj?.customer_name || null,
        memberWorked: Number(r.member_worked) || 0,
        totalHours: Math.round((Number(r.total_hours) || 0) * 100) / 100,
        firstMonthSeen,
        parentCategory: r.parent_project_code,
      };
    });

    // ─── 6. Response ─────────────────────────────────────────────────────
    return res.status(200).json({
      title: 'Project wise summary (App Dev)',
      totalRecords: projects.length,
      projects,
    });
  } catch (err) {
    console.error('❌ getProjectWiseSummary error:', err.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to load project-wise summary',
      error: err.message,
    });
  }
};

const getResourceBreakdown = async (req, res) => {
  try {
    // ─── 1. Resolve Token ────────────────────────────────────────────────
    const uatToken =
      getUatToken(req.user?.emp_id) || process.env.PMS_SERVICE_TOKEN || null;

    if (!uatToken) {
      return res.status(401).json({
        success: false,
        message: 'No PMS session found. Please log in again.',
      });
    }

    // ─── 2. Fetch App Dev Employees from HRMS ────────────────────────────
    const allEmployees = await fetchAllEmployeesFromHrms();
    
    const appDevEmps = allEmployees.filter((e) => {
      const dept = String(e.Name_of_Department || '').trim();
      const status = String(e.Employee_Status || '').trim().toLowerCase();
      const designation = String(e.Employee_Designation || '').toLowerCase();

      return (
        dept === 'Delivery' &&
        status === 'active' &&
        designation.includes('application development')
      );
    });

    if (appDevEmps.length === 0) {
      return res.status(200).json({
        title: 'Resource breakdown',
        totalRecords: 0,
        resources: [],
      });
    }

    const appDevEmpIds = appDevEmps.map((e) => e.Employee_ID).filter(Boolean);
    const placeholders = appDevEmpIds.map(() => '?').join(',');

    // Map for quick name lookup
    const hrmsById = new Map();
    for (const e of appDevEmps) {
      hrmsById.set(String(e.Employee_ID).trim(), e);
    }

    // ─── 3. Aggregate DB by (Employee + Project Category) ────────────────
    const rows = await query(
      `SELECT
         projectcategory_code,
         MAX(projectcategory_name) AS projectcategory_name,
         MAX(project_code)         AS parent_project_code,
         employee_id,
         MAX(employee_name)        AS employee_name,
         SUM(number_of_hours)      AS logged_hours
       FROM hrms_timesheet
       WHERE projectcategory_code IS NOT NULL
         AND TRIM(projectcategory_code) <> ''
         AND projectcategory_code <> 'NA'
         AND employee_id IN (${placeholders})
       GROUP BY projectcategory_code, employee_id
       ORDER BY projectcategory_code, logged_hours DESC`,
      appDevEmpIds
    );

    if (rows.length === 0) {
      return res.status(200).json({
        title: 'Resource breakdown',
        totalRecords: 0,
        resources: [],
      });
    }

    // ─── 4. Fetch PMS Projects for customer_name ─────────────────────────
    let pmsProjects = [];
    try {
      const rawPms = await pmsGet(uatToken, '/api/pms/getAllProjects');
      pmsProjects = Array.isArray(rawPms?.projects) ? rawPms.projects : 
                    Array.isArray(rawPms?.data?.projects) ? rawPms.data.projects : [];
    } catch (err) {
      console.warn('⚠️ PMS getAllProjects failed, customer_name will be null:', err.message);
    }

    // ─── 5. Merge and Format ─────────────────────────────────────────────
    const resources = rows.map((r) => {
      const code = r.projectcategory_code;
      const hrmsName = String(r.projectcategory_name || '').toLowerCase();

      // Match project to PMS to get customer name
      const pmsProj = pmsProjects.find((p) => {
        if (!p.project_title) return false;
        const title = p.project_title.toLowerCase();
        
        if (title === hrmsName) return true;
        if (title.includes(code.toLowerCase()) || hrmsName.includes(code.toLowerCase())) return true;

        const cleanTitle = title.replace(/[^a-z0-9]/g, ' ');
        const cleanHrms = hrmsName.replace(/[^a-z0-9]/g, ' ');
        if (cleanTitle.includes('work quantify') && cleanHrms.includes('work quantify')) return true;

        return false;
      });

      // Ensure we have the latest HRMS data for the employee (in case DB is stale)
      const hrmsEmp = hrmsById.get(String(r.employee_id).trim()) || {};

      return {
        projectCode: code,
        projectName: r.projectcategory_name,
        customerName: pmsProj?.customer_name || null,
        Emp_id: r.employee_id,                                   // matching your requested shape
        Emp_Name: hrmsEmp.Employee_Name || r.employee_name,      // fallback to DB name if HRMS missing
        loggedHours: Math.round((Number(r.logged_hours) || 0) * 100) / 100,
        parentCategory: r.parent_project_code,
      };
    });

    // ─── 6. Response ─────────────────────────────────────────────────────
    return res.status(200).json({
      title: 'Resource breakdown',
      totalRecords: resources.length,
      resources,
    });
  } catch (err) {
    console.error('❌ getAppDevResourceBreakdown error:', err.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to load resource breakdown',
      error: err.message,
    });
  }
};


module.exports = {
  syncHrmsTimesheets,
  getHrmsTimesheets,
  getCategoryTimesheetsGroupedByEmployee,
  fetchCategoryTimesheetsGroupedByEmployee,
  getAllCategoriesTimesheetsReport,
   getAppDevDesignationTimesheetsReport,
    getProjectWiseSummary,
    getResourceBreakdown 
};
