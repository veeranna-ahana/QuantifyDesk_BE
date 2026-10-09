const { query } = require("../config/db");
const { getUatToken } = require("../../helpers/pmsTokenStore");
const {
  pmsGet,
  extractProjects,
  extractProjectDetails,
  normalizePMSError,
} = require("../../helpers/pmsHelper");
const { getEmployeeNameMapFromHRMS } = require("./hrms.controller");

const HOURS_PER_DAY = 8; // adjust if the org uses a different value

// ============================================================================
// Quantify Dashboard
//
// Separate on purpose from importProject.controller.js — this is its own
// feature (the main Dashboard screen), not part of the Import Project
// wizard itself, so it gets its own controller/routes file pair. Named
// "quantifyDashboard" (not "dashboard") to stay distinct from the
// pre-existing src/controller/dashboard.controller.js (an unrelated
// dashboard from the old application) and avoid any confusion between
// the two.
//
// PMS calls go through helpers/pmsHelper.js's pmsGet, the same shared
// helper every other PMS-calling controller now uses (importProject,
// dailyReport) — no more per-file PMS_CONFIG/getPMSHeaders/axios copies.
// The auth pattern is unchanged: getUatToken(emp_id) from pmsTokenStore.js.
// ============================================================================

// Maps PMS's own task status values straight to our three buckets. PMS only ever sends exactly
// "COMPLETED", "STARTED", or "YET_TO_START" for a task's `status` (confirmed against a real
// getProjectDetails response) — a previous loose `.includes("progress")` check here never
// matched "STARTED" and silently miscounted every in-progress task as "Not Started". Duplicated
// here (not imported from importProject.controller.js, which has the same fix) so this file has
// no dependency on the wizard controller and can evolve independently.
function normalizeTaskStatus(rawStatus) {
  const status = String(rawStatus || "").toUpperCase();

  if (status === "COMPLETED") {
    return "completed";
  }
  if (status === "STARTED") {
    return "in_progress";
  }
  return "not_started";
}

// ─────────────────────────────────────────────────────────────────────────
// Classifies ONE project's live PMS status + planned_end_date into the
// buckets the Dashboard widgets need. Loose contains-match on the status
// string, plus one hard rule confirmed directly by the user for "Delayed":
// a project is delayed if its planned_end_date has already passed and it
// isn't Completed — this overrides whatever literal status PMS sends, so
// "Delayed" always means the same thing everywhere it appears on the
// Dashboard.
//
// "At Risk" is NOT implemented yet — the threshold for it (how close to
// the deadline / how far behind completion counts as at-risk) hasn't been
// decided yet, so every non-completed/non-delayed/non-on-hold project
// currently falls through to "On Track" (health overview) / "Active"
// (status distribution). Revisit once that threshold is confirmed.
// ─────────────────────────────────────────────────────────────────────────
function classifyProjectStatus(rawStatus, plannedEndDate) {
  const status = String(rawStatus || "").toLowerCase();

  const completed = status.includes("complete") || status.includes("done");

  let pastDue = false;
  if (plannedEndDate) {
    const endDate = new Date(plannedEndDate);
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    pastDue = !Number.isNaN(endDate.getTime()) && endDate < todayStart;
  }

  const delayed = !completed && (pastDue || status.includes("delay"));
  const onHold =
    !completed &&
    !delayed &&
    (status.includes("hold") || status.includes("inactive"));
  const inProgressLiteral =
    !completed && !delayed && !onHold && status.includes("progress");
  // "Active" = anything not completed/delayed/on-hold, for the Status
  // Distribution donut's catch-all slice (covers inProgressLiteral + any
  // other unmatched literal status).
  const active = !completed && !delayed && !onHold;

  return { completed, delayed, onHold, inProgressLiteral, active };
}

// Turns a classification into the single label the Health Overview bar
// chart and the Delivery Performance table's STATUS column both use.
// Priority order: Completed > Delayed > In Progress (literal) > On Track
// (catch-all). At Risk is intentionally unreachable right now — see the
// note on classifyProjectStatus above.
function healthBucketLabel(classification) {
  if (classification.completed) return "Completed";
  if (classification.delayed) return "Delayed";
  if (classification.inProgressLiteral) return "In Progress";
  return "On Track";
}

// Turns a classification into the Status Distribution donut's label.
function distributionBucketLabel(classification) {
  if (classification.completed) return "Completed";
  if (classification.delayed) return "Delayed";
  if (classification.onHold) return "On Hold";
  return "Active";
}

// ─────────────────────────────────────────────────────────────────────────
// GET /api/import-project/dashboard/overview
// One combined API for the Dashboard's Cards, Project Health Overview,
// Project Status Distribution and Project Delivery Performance table.
// Scoped ONLY to projects that have gone through our Import Project
// wizard (our own project_info rows) — not every PMS project.
//
// Bundled into one call on purpose: Cards/Health Overview/Status
// Distribution all need the exact same input (one PMS getAllProjects
// call, matched to our project_info rows — same pattern
// importProject.controller.js's getImportedProjects already uses).
// Splitting these into separate endpoints would mean the frontend
// re-fetches that identical PMS data 3 times for no benefit.
//
// The Delivery Performance table additionally needs each project's
// completion % (units come from our own task_info). There is no bulk PMS
// endpoint for milestones/tasks across all projects (confirmed), so this
// falls back to one getProjectDetails call per imported project, run in
// parallel via Promise.allSettled so one PMS failure doesn't take down the
// whole dashboard — that project's row just renders with completion 0/
// unknown instead.
//
// Risk column is intentionally always null for now — risk_category isn't
// live on PMS's task payload yet; once it is, Delivery Performance can
// roll it up per project.
// ─────────────────────────────────────────────────────────────────────────
const getDashboardOverview = async (req, res, next) => {
  try {
    const localRows = await query(
      `SELECT project_info_id, project_id, project_code
         FROM project_info
        ORDER BY project_info_id DESC`,
    );

    const emptyResponse = {
      cards: { all_projects: 0, in_progress: 0, completed: 0, delayed: 0 },
      health_overview: {
        total_projects: 0,
        buckets: [
          "On Track",
          "In Progress",
          "At Risk",
          "Delayed",
          "Completed",
        ].map((status) => ({
          status,
          count: 0,
          percentage: 0,
        })),
      },
      status_distribution: {
        total_projects: 0,
        buckets: ["Active", "Completed", "On Hold", "Delayed"].map(
          (status) => ({
            status,
            count: 0,
            percentage: 0,
          }),
        ),
      },
      delivery_performance: [],
    };

    if (localRows.length === 0) {
      return res.status(200).json(emptyResponse);
    }

    // authMiddleware has already verified our own JWT and set req.user.
    // PMS needs the original UAT token cached at login, same as pms-sync.
    const empId = req.user?.emp_id;
    const uatToken = getUatToken(empId);
    if (!uatToken) {
      return res.status(401).json({
        message:
          "PMS session not found or expired. Please log in again to refresh your PMS access.",
      });
    }

    // ── One PMS call for status/title/dates across ALL our projects ───────
    let pmsProjects = [];
    try {
      const data = await pmsGet(uatToken, "/api/pms/getAllProjects");
      pmsProjects = extractProjects(data);
    } catch (pmsErr) {
      console.error(
        "Error fetching PMS projects for dashboard:",
        pmsErr.message,
      );
      // Fall through with pmsProjects = [] — every project degrades to
      // "unknown status" below rather than failing the whole dashboard.
    }

    const pmsByProjectId = new Map(
      pmsProjects.map((p) => [String(p.project_id || p.id), p]),
    );

    // ── Our own units total per project (task_info.unit), one query ───────
    const unitRows = await query(
      `SELECT project_info_id, SUM(unit) AS total_units
         FROM task_info
        WHERE unit IS NOT NULL
        GROUP BY project_info_id`,
    );
    const unitsByProjectInfoId = new Map(
      unitRows.map((r) => [r.project_info_id, Number(r.total_units) || 0]),
    );

    // ── Per-project PMS milestones/tasks, for completion % only ───────────
    // No bulk PMS endpoint for this exists, so one getProjectDetails call
    // per imported project, run in parallel.
    const detailResults = await Promise.allSettled(
      localRows.map((row) =>
        pmsGet(uatToken, "/api/pms/getProjectDetails", {
          projectId: row.project_id,
        }),
      ),
    );

    // ── Aggregate everything per project ───────────────────────────────────
    const cards = {
      all_projects: localRows.length,
      in_progress: 0,
      completed: 0,
      delayed: 0,
    };
    const healthCounts = {
      "On Track": 0,
      "In Progress": 0,
      "At Risk": 0,
      Delayed: 0,
      Completed: 0,
    };
    const distributionCounts = {
      Active: 0,
      Completed: 0,
      "On Hold": 0,
      Delayed: 0,
    };

    const deliveryPerformance = localRows.map((row, index) => {
      const pmsProject = pmsByProjectId.get(String(row.project_id));
      const rawStatus = pmsProject?.status || null;
      const plannedEndDate = pmsProject?.planned_end_date || null;

      const classification = classifyProjectStatus(rawStatus, plannedEndDate);

      // Cards: In Progress here is the literal-status bucket only, same
      // loose-match convention as everywhere else in this file.
      if (classification.completed) cards.completed += 1;
      else if (classification.delayed) cards.delayed += 1;
      else if (classification.inProgressLiteral) cards.in_progress += 1;

      const healthLabel = healthBucketLabel(classification);
      healthCounts[healthLabel] += 1;

      const distributionLabel = distributionBucketLabel(classification);
      distributionCounts[distributionLabel] += 1;

      // Completion % from this project's PMS milestones/tasks, when the
      // fan-out call for it succeeded.
      let completionPercentage = 0;
      const detailResult = detailResults[index];
      if (detailResult.status === "fulfilled") {
        const { tasksDetails } = detailResult.value || {};
        const safeTasks = tasksDetails || [];
        const completedTasks = safeTasks.filter(
          (t) => normalizeTaskStatus(t.status) === "completed",
        ).length;
        completionPercentage =
          safeTasks.length === 0
            ? 0
            : Math.round((completedTasks / safeTasks.length) * 100);
      }

      return {
        project_info_id: row.project_info_id,
        project_id: row.project_id,
        project_title: pmsProject?.project_title || pmsProject?.title || null,
        project_code: row.project_code,
        units: unitsByProjectInfoId.get(row.project_info_id) || 0,
        completion_percentage: completionPercentage,
        risk: null,
        status: healthLabel,
      };
    });

    const totalProjects = localRows.length;
    const toBucketArray = (counts) =>
      Object.entries(counts).map(([status, count]) => ({
        status,
        count,
        percentage:
          totalProjects === 0 ? 0 : Math.round((count / totalProjects) * 100),
      }));

    return res.status(200).json({
      cards,
      health_overview: {
        total_projects: totalProjects,
        buckets: toBucketArray(healthCounts),
      },
      status_distribution: {
        total_projects: totalProjects,
        buckets: toBucketArray(distributionCounts),
      },
      delivery_performance: deliveryPerformance,
    });
  } catch (err) {
    return next(err);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/import-project/dashboard/all-employees
// Employee Utilization table — every employee who has any assignment
// (task_info row OR effort_estimate row) across imported projects, with
// per-project and totals.
//
// Hours are honest, not fabricated: `logged_hours` comes from `hrms_timesheet`
// joined by (employee_id, projectcategory_code) — if that table has no rows
// for an employee/project yet, logged_hours is correctly 0, not a guess.
// `assigned_hours` is derived from effort_estimate's effort_days+buffer_days
// (our own data), so it's real wherever effort has been estimated.
//
// ?include_pms=true additionally fans out one PMS getProjectDetails call per
// project per employee (slow — used for a full drill-down, not the list view).
// ?emp_id=AS01989 filters to one employee (same shape, one-entry array).
// ─────────────────────────────────────────────────────────────────────────────
const getAllEmployeesUtilization = async (req, res) => {
  try {
    const includePms = String(req.query.include_pms).toLowerCase() === "true";
    const filterEmpId = req.query.emp_id || null;

    const employees = await query(
      `SELECT a.emp_id
       FROM (
         SELECT DISTINCT emp_id FROM task_info WHERE emp_id IS NOT NULL
         UNION
         SELECT emp_id FROM effort_estimate WHERE emp_id IS NOT NULL
       ) AS a
       ${filterEmpId ? "WHERE a.emp_id = ?" : ""}
       ORDER BY a.emp_id`,
      filterEmpId ? [filterEmpId] : [],
    );
    // Names resolved from HRMS, not master.emp — per request, employee details here must come
    // from HRMS only. Covers every status (not just Active), so someone who's since gone
    // inactive still shows their real name instead of falling back to a raw emp_id.
    const empNameMap = await getEmployeeNameMapFromHRMS();

    if (employees.length === 0) {
      return res
        .status(200)
        .json({ success: true, total_employees: 0, employees: [] });
    }

    const empIds = employees.map((e) => e.emp_id);
    const placeholders = empIds.map(() => "?").join(",");

    const rows = await query(
      `SELECT
         ti.emp_id                                        AS emp_id,
         pi.project_info_id                               AS project_info_id,
         pi.project_id                                    AS pms_project_id,
         pi.project_code                                  AS project_code,
         pi.sub_category                                  AS project_category_code,
         COALESCE(ta.assigned_task_count, 0)              AS assigned_task_count,
         COALESCE(ta.assigned_units,      0)              AS assigned_units,
         COALESCE(ef.assigned_days,       0)              AS assigned_days,
         COALESCE(hr.logged_hours,        0)              AS logged_hours,
         -- Role: an employee can be tagged under MORE THAN ONE role on the same project (e.g.
         -- both "BE Dev" and "FE Dev" across different tasks/effort rows) — every distinct role
         -- from BOTH task_info and effort_estimate is collected here (comma-separated), not just
         -- one. Previously this used MAX(role), which silently kept only one role per project and
         -- dropped the rest. Merged into a de-duplicated list in JS below.
         ta.role                                           AS task_roles,
         ef.role                                           AS effort_roles
       FROM (
         SELECT emp_id, project_info_id FROM task_info
         UNION
         SELECT emp_id, project_info_id FROM effort_estimate
       ) ti
       JOIN project_info pi ON pi.project_info_id = ti.project_info_id
       LEFT JOIN (
         SELECT emp_id, project_info_id,
                COUNT(DISTINCT task_id) AS assigned_task_count,
                SUM(unit)               AS assigned_units,
                GROUP_CONCAT(DISTINCT role ORDER BY role SEPARATOR ',') AS role
           FROM task_info
          GROUP BY emp_id, project_info_id
       ) ta ON ta.emp_id = ti.emp_id AND ta.project_info_id = ti.project_info_id
       LEFT JOIN (
         SELECT emp_id, project_info_id,
                SUM(effort_days + buffer_days) AS assigned_days,
                GROUP_CONCAT(DISTINCT role ORDER BY role SEPARATOR ',') AS role
           FROM effort_estimate
          GROUP BY emp_id, project_info_id
       ) ef ON ef.emp_id = ti.emp_id AND ef.project_info_id = ti.project_info_id
       LEFT JOIN (
         SELECT employee_id, projectcategory_code,
                SUM(number_of_hours) AS logged_hours
           FROM hrms_timesheet
          GROUP BY employee_id, projectcategory_code
       ) hr ON hr.employee_id = ti.emp_id AND hr.projectcategory_code = pi.sub_category
       WHERE ti.emp_id IN (${placeholders})
       ORDER BY ti.emp_id, pi.project_info_id`,
      empIds,
    );

    const byEmployee = new Map();

    for (const r of rows) {
      if (!byEmployee.has(r.emp_id)) {
        byEmployee.set(r.emp_id, {
          emp_id: r.emp_id,
          emp_name: empNameMap.get(String(r.emp_id)) || null,
          total_projects: 0,
          total_assigned_days: 0,
          total_assigned_hours: 0,
          total_logged_hours: 0,
          projects: [],
        });
      }

      const emp = byEmployee.get(r.emp_id);
      const assignedDays = Number(r.assigned_days) || 0;
      const assignedHours = assignedDays * HOURS_PER_DAY;
      const loggedHours = Number(r.logged_hours) || 0;

      // Merge task_info's roles and effort_estimate's roles into one de-duplicated list — an
      // employee can genuinely be "BE Dev" AND "FE Dev" on the same project.
      const mergedRoles = [
        ...new Set(
          [r.task_roles, r.effort_roles]
            .filter(Boolean)
            .flatMap((s) => s.split(","))
            .map((s) => s.trim())
            .filter(Boolean),
        ),
      ];

      emp.projects.push({
        project_info_id: r.project_info_id,
        pms_project_id: r.pms_project_id,
        project_code: r.project_code,
        project_category_code: r.project_category_code,

        // Kept for any existing caller still reading a single `role` string (first role, same
        // as the old behavior's intent) — `roles` below is the real, complete list.
        role: mergedRoles[0] || null,
        roles: mergedRoles,
        assigned_task_count: Number(r.assigned_task_count) || 0,
        assigned_units: Number(r.assigned_units) || 0,
        assigned_days: assignedDays,
        assigned_hours: assignedHours,
        logged_hours: loggedHours,
      });

      emp.total_projects += 1;
      emp.total_assigned_days += assignedDays;
      emp.total_assigned_hours += assignedHours;
      emp.total_logged_hours += loggedHours;
    }

    // Optional PMS enrichment — per-project task dates/status for this employee's own tasks.
    if (includePms) {
      const uatToken = getUatToken(req.user?.emp_id);
      if (!uatToken) {
        return res.status(401).json({
          success: false,
          message:
            "PMS session not found or expired. Please log in again to refresh your PMS access.",
        });
      }

      for (const emp of byEmployee.values()) {
        for (const proj of emp.projects) {
          try {
            const raw = await pmsGet(uatToken, "/api/pms/getProjectDetails", {
              projectId: proj.pms_project_id,
            });
            const { tasks } = extractProjectDetails(raw);
            const myTasks = tasks.filter(
              (t) => String(t.emp_id).trim() === String(emp.emp_id).trim(),
            );

            proj.completed_tasks = myTasks.filter(
              (t) => t.status === "COMPLETED",
            ).length;
            proj.in_progress_tasks = myTasks.filter(
              (t) => t.status === "STARTED",
            ).length;
            proj.pending_tasks = myTasks.filter(
              (t) => t.status === "YET_TO_START",
            ).length;
          } catch (err) {
            console.warn(
              `⚠️ PMS fetch failed for project ${proj.pms_project_id}:`,
              err.message,
            );
            proj.completed_tasks = null;
            proj.in_progress_tasks = null;
            proj.pending_tasks = null;
          }
        }
      }
    }

    const employees_out = [...byEmployee.values()].map((e) => ({
      ...e,
      total_assigned_days: Math.round(e.total_assigned_days * 100) / 100,
      total_assigned_hours: Math.round(e.total_assigned_hours * 100) / 100,
      total_logged_hours: Math.round(e.total_logged_hours * 100) / 100,
    }));

    return res.status(200).json({
      success: true,
      total_employees: employees_out.length,
      employees: employees_out,
    });
  } catch (err) {
    console.error("❌ getAllEmployeesUtilization error:", err.message);
    const { status, body } = normalizePMSError(err);
    return res.status(status).json(body);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/import-project/dashboard/employee/:emp_id
// One employee's drill-down: per-project task counts/status + PMS planned/
// actual dates for THEIR OWN tasks in that project, plus assigned/logged
// hours totals. Used for the Employee Utilization row's expanded detail.
//
// Auth: same pattern as every other PMS-calling endpoint in this app — the
// UAT token cached at THIS request's own login (getUatToken(req.user.emp_id)),
// never a token read off the request headers or an env var. The emp_id being
// looked up (path param) is just which employee's data to return; it isn't
// who is asking.
// ─────────────────────────────────────────────────────────────────────────────
const getEmployeeUtilization = async (req, res) => {
  try {
    const empId = req.params.emp_id || req.query.emp_id;
    if (!empId) {
      return res
        .status(400)
        .json({ success: false, message: "emp_id is required" });
    }

    const uatToken = getUatToken(req.user?.emp_id);
    if (!uatToken) {
      return res.status(401).json({
        success: false,
        message:
          "PMS session not found or expired. Please log in again to refresh your PMS access.",
      });
    }

    const rows = await query(
      `SELECT
         pi.project_info_id,
         pi.project_id            AS pms_project_id,
         pi.project_code,
         pi.sub_category,
    
         COALESCE(t.assigned_task_count, 0) AS assigned_task_count,
         COALESCE(t.assigned_units,      0) AS assigned_units,
         COALESCE(e.assigned_days,       0) AS assigned_days,
         COALESCE(h.logged_hours,        0) AS logged_hours,
         -- Role: an employee can genuinely be tagged under MORE THAN ONE role on the same
         -- project (e.g. both "BE Dev" and "FE Dev") — every distinct role from BOTH task_info
         -- and effort_estimate is collected here (comma-separated), not collapsed to one via
         -- MAX(role) like before (which silently dropped every role but the alphabetically last).
         -- Merged into a de-duplicated list in JS below.
         t.role AS task_roles,
         e.role AS effort_roles
       FROM project_info pi
       LEFT JOIN (
         SELECT project_info_id,
                COUNT(DISTINCT task_id) AS assigned_task_count,
                SUM(unit)               AS assigned_units,
                GROUP_CONCAT(DISTINCT role ORDER BY role SEPARATOR ',') AS role
           FROM task_info
          WHERE emp_id = ?
          GROUP BY project_info_id
       ) t ON t.project_info_id = pi.project_info_id
       LEFT JOIN (
         SELECT project_info_id,
                SUM(effort_days + buffer_days) AS assigned_days,
                GROUP_CONCAT(DISTINCT role ORDER BY role SEPARATOR ',') AS role
           FROM effort_estimate
          WHERE emp_id = ?
          GROUP BY project_info_id
       ) e ON e.project_info_id = pi.project_info_id
       LEFT JOIN (
         SELECT projectcategory_code, SUM(number_of_hours) AS logged_hours
           FROM hrms_timesheet
          WHERE employee_id = ?
          GROUP BY projectcategory_code
       ) h ON h.projectcategory_code = pi.sub_category
       WHERE t.project_info_id IS NOT NULL OR e.project_info_id IS NOT NULL
       ORDER BY pi.project_info_id`,
      [empId, empId, empId],
    );

    if (rows.length === 0) {
      return res.status(200).json({
        success: true,
        emp_id: empId,
        total_projects: 0,
        totals: {
          total_assigned_days: 0,
          total_assigned_hours: 0,
          total_logged_hours: 0,
        },
        projects: [],
      });
    }

    const enriched = await Promise.all(
      rows.map(async (p) => {
        let tasks = [];
        try {
          const raw = await pmsGet(uatToken, "/api/pms/getProjectDetails", {
            projectId: p.pms_project_id,
          });
          ({ tasks } = extractProjectDetails(raw));
        } catch (err) {
          console.warn(
            `⚠️ PMS fetch failed for project ${p.pms_project_id}:`,
            err.message,
          );
        }

        const myTasks = tasks.filter(
          (t) => String(t.emp_id).trim() === String(empId).trim(),
        );
        const completed = myTasks.filter((t) => t.status === "COMPLETED");
        const inProgress = myTasks.filter((t) => t.status === "STARTED");
        const pending = myTasks.filter((t) => t.status === "YET_TO_START");

        const plannedStarts = myTasks
          .map((t) => t.planned_start_date)
          .filter(Boolean)
          .sort();
        const plannedEnds = myTasks
          .map((t) => t.planned_end_date)
          .filter(Boolean)
          .sort();

        // Merge task_info's roles and effort_estimate's roles into one de-duplicated list — see
        // the SQL comment above for why this can legitimately be more than one role.
        const mergedRoles = [
          ...new Set(
            [p.task_roles, p.effort_roles]
              .filter(Boolean)
              .flatMap((s) => s.split(","))
              .map((s) => s.trim())
              .filter(Boolean),
          ),
        ];

        return {
          project_info_id: p.project_info_id,
          pms_project_id: p.pms_project_id,
          project_code: p.project_code,
          project_category_code: p.sub_category,

          // Kept for any existing caller still reading a single `role` string — `roles` below is
          // the real, complete list.
          role: mergedRoles[0] || null,
          roles: mergedRoles,
          assigned_task_count: Number(p.assigned_task_count) || 0,
          assigned_units: Number(p.assigned_units) || 0,
          completed_tasks: completed.length,
          in_progress_tasks: inProgress.length,
          pending_tasks: pending.length,
          total_tasks_in_project: myTasks.length,
          task_planned_start_date: plannedStarts[0] || null,
          task_planned_end_date: plannedEnds[plannedEnds.length - 1] || null,
          assigned_days: Number(p.assigned_days) || 0,
          assigned_hours: (Number(p.assigned_days) || 0) * HOURS_PER_DAY,
          logged_hours: Number(p.logged_hours) || 0,
        };
      }),
    );

    const totals = enriched.reduce(
      (acc, p) => ({
        total_assigned_days: acc.total_assigned_days + p.assigned_days,
        total_assigned_hours: acc.total_assigned_hours + p.assigned_hours,
        total_logged_hours: acc.total_logged_hours + p.logged_hours,
      }),
      {
        total_assigned_days: 0,
        total_assigned_hours: 0,
        total_logged_hours: 0,
      },
    );

    return res.status(200).json({
      success: true,
      emp_id: empId,
      total_projects: enriched.length,
      totals,
      projects: enriched,
    });
  } catch (err) {
    console.error("❌ getEmployeeUtilization error:", err.message);
    const { status, body } = normalizePMSError(err);
    return res.status(status).json(body);
  }
};

module.exports = {
  getDashboardOverview,
  getAllEmployeesUtilization,
  getEmployeeUtilization,
};
