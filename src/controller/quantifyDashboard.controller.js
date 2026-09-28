const { query } = require("../config/db");
const { getUatToken } = require("../../helpers/pmsTokenStore");
const { pmsGet, extractProjects, normalizePMSError, extractProjectDetails } = require("../../helpers/pmsHelper");

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

// Normalizes whatever PMS sends in a task's `status` field. Same loose
// contains-match convention as importProject.controller.js's
// normalizeTaskStatus — duplicated here (not imported) so this file has no
// dependency on the wizard controller and can evolve independently.
function normalizeTaskStatus(rawStatus) {
  const status = String(rawStatus || "").toLowerCase();

  if (status.includes("progress")) {
    return "in_progress";
  }
  if (status.includes("complete") || status.includes("done")) {
    return "completed";
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
// GET /api/utilization/all-employees
// Lists every employee with assigned projects + per-project + totals.
//
// Query params:
//   ?include_pms=true    fetch PMS task details per project (slower)
//   ?emp_id=AS01989      filter to one employee (optional)
// ─────────────────────────────────────────────────────────────────────────────
const getAllEmployeesUtilization = async (req, res) => {
  try {
    const HOURS_PER_DAY = 8;
    const includePms = String(req.query.include_pms).toLowerCase() === "true";
    const filterEmpId = req.query.emp_id || null;

    // ─── 1. Find all employees with any assignment ──────────────────────────
    const assignmentParams = [];
    let assignmentWhere = "";

    if (filterEmpId) {
      assignmentWhere = "AND ti.emp_id = ?";
      assignmentParams.push(filterEmpId);
    }

    const employees = await query(
      `SELECT
     a.emp_id,
     e.emp_name
   FROM (
     SELECT DISTINCT emp_id FROM task_info WHERE emp_id IS NOT NULL
     UNION
     SELECT emp_id FROM effort_estimate WHERE emp_id IS NOT NULL
   ) AS a
   LEFT JOIN master.emp e ON e.emp_id = a.emp_id
   ${filterEmpId ? "WHERE a.emp_id = ?" : ""}
   ORDER BY a.emp_id`,
      filterEmpId ? [filterEmpId] : [],
    );

    if (employees.length === 0) {
      return res.status(200).json({
        success: true,
        total_employees: 0,
        employees: [],
      });
    }

    const empIds = employees.map((e) => e.emp_id);

    // ─── 2. Fetch per-project data for all these employees in one query ────
    const placeholders = empIds.map(() => "?").join(",");

    const rows = await query(
      `SELECT
         ti.emp_id                                        AS emp_id,
         pi.project_info_id                               AS project_info_id,
         pi.project_id                                    AS pms_project_id,
         pi.project_code                                  AS project_code,
         pi.sub_category                                  AS project_category_code,
         pi.description                                   AS description,

         COALESCE(ta.assigned_task_count, 0)              AS assigned_task_count,
         COALESCE(ta.assigned_units,      0)              AS assigned_units,
         COALESCE(ef.assigned_days,       0)              AS assigned_days,
         COALESCE(hr.logged_hours,        0)              AS logged_hours

       FROM (
         SELECT emp_id, project_info_id FROM task_info
         UNION
         SELECT emp_id, project_info_id FROM effort_estimate
       ) ti

       JOIN project_info pi
         ON pi.project_info_id = ti.project_info_id

       LEFT JOIN (
         SELECT emp_id, project_info_id,
                COUNT(DISTINCT task_id) AS assigned_task_count,
                SUM(unit)               AS assigned_units
           FROM task_info
          GROUP BY emp_id, project_info_id
       ) ta
         ON ta.emp_id = ti.emp_id AND ta.project_info_id = ti.project_info_id

       LEFT JOIN (
         SELECT emp_id, project_info_id,
                SUM(effort_days + buffer_days) AS assigned_days
           FROM effort_estimate
          GROUP BY emp_id, project_info_id
       ) ef
         ON ef.emp_id = ti.emp_id AND ef.project_info_id = ti.project_info_id

       LEFT JOIN (
         SELECT employee_id, projectcategory_code,
                SUM(number_of_hours) AS logged_hours
           FROM hrms_timesheet
          GROUP BY employee_id, projectcategory_code
       ) hr
         ON hr.employee_id = ti.emp_id
        AND hr.projectcategory_code = pi.sub_category

       WHERE ti.emp_id IN (${placeholders})
       ORDER BY ti.emp_id, pi.project_info_id`,
      empIds,
    );

    // ─── 3. Group rows by employee ─────────────────────────────────────────
    const nameMap = new Map(employees.map((e) => [e.emp_id, e.emp_name]));
    const byEmployee = new Map();

    for (const r of rows) {
      if (!byEmployee.has(r.emp_id)) {
        byEmployee.set(r.emp_id, {
          emp_id: r.emp_id,
          emp_name: nameMap.get(r.emp_id) || null,
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

      emp.projects.push({
        project_info_id: r.project_info_id,
        pms_project_id: r.pms_project_id,
        project_code: r.project_code,
        project_category_code: r.project_category_code,
        description: r.description,
        // assigned_task_count: Number(r.assigned_task_count) || 0,
        // assigned_units: Number(r.assigned_units) || 0,
        // assigned_days: assignedDays,
        // assigned_hours: assignedHours,
        // logged_hours: loggedHours,
      });

      emp.total_projects += 1;
      emp.total_assigned_days += assignedDays;
      emp.total_assigned_hours += assignedHours;
      emp.total_logged_hours += loggedHours;
    }

    // ─── 4. Optional PMS enrichment (task dates per project) ───────────────
    if (includePms) {
      const { getUatToken } = require("../helpers/pmsTokenStore");
      const uatToken = getUatToken(req.user?.emp_id);

      if (!uatToken) {
        return res.status(401).json({
          success: false,
          message: "No PMS session found for this user. Please log in again.",
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

            const plannedStarts = myTasks
              .map((t) => t.planned_start_date)
              .filter(Boolean)
              .sort();
            const plannedEnds = myTasks
              .map((t) => t.planned_end_date)
              .filter(Boolean)
              .sort();
            const actualStarts = myTasks
              .map((t) => t.actual_start_date)
              .filter(Boolean)
              .sort();
            const actualEnds = myTasks
              .map((t) => t.actual_end_date)
              .filter(Boolean)
              .sort();

            proj.task_planned_start_date = plannedStarts[0] || null;
            proj.task_planned_end_date =
              plannedEnds[plannedEnds.length - 1] || null;
            proj.task_actual_start_date = actualStarts[0] || null;
            proj.task_actual_end_date =
              actualEnds[actualEnds.length - 1] || null;
            proj.task_status_summary = {
              COMPLETED: myTasks.filter((t) => t.status === "COMPLETED").length,
              STARTED: myTasks.filter((t) => t.status === "STARTED").length,
              YET_TO_START: myTasks.filter((t) => t.status === "YET_TO_START")
                .length,
              INACTIVE: myTasks.filter((t) => t.status === "INACTIVE").length,
            };
          } catch (err) {
            console.warn(
              `⚠️ PMS fetch failed for project ${proj.pms_project_id}:`,
              err.message,
            );
            proj.task_planned_start_date = null;
            proj.task_planned_end_date = null;
            proj.task_actual_start_date = null;
            proj.task_actual_end_date = null;
            proj.task_status_summary = null;
          }
        }
      }
    }

    // ─── 5. Response ───────────────────────────────────────────────────────
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

const HOURS_PER_DAY = 8; // adjust if your org uses a different value

const getEmployeeUtilization = async (req, res) => {
  try {
    const empId = req.query.emp_id || req.params.emp_id;

    if (!empId) {
      return res.status(400).json({
        success: false,
        message: "emp_id is required",
      });
    }

    // ✅ Extract the caller's token (or fall back to a service token)
    const uatToken =
      (req.headers.authorization || "").replace(/^Bearer\s+/i, "") ||
      process.env.PMS_SERVICE_TOKEN ||
      null;

    if (!uatToken) {
      return res.status(401).json({
        success: false,
        message:
          "PMS token missing. Send Authorization header or configure PMS_SERVICE_TOKEN.",
      });
    }

    // ─── 1. Fetch projects + aggregated local data ─────────────────────────
    const rows = await query(
      `SELECT
         pi.project_info_id,
         pi.project_id            AS pms_project_id,
         pi.project_code,
         pi.sub_category,
         pi.description,
         COALESCE(t.assigned_task_count, 0) AS assigned_task_count,
         COALESCE(t.assigned_units,      0) AS assigned_units,
         COALESCE(e.assigned_days,       0) AS assigned_days,
         COALESCE(h.logged_hours,        0) AS logged_hours
       FROM project_info pi
       LEFT JOIN (
         SELECT project_info_id,
                COUNT(DISTINCT task_id) AS assigned_task_count,
                SUM(unit)               AS assigned_units
           FROM task_info
          WHERE emp_id = ?
          GROUP BY project_info_id
       ) t ON t.project_info_id = pi.project_info_id
       LEFT JOIN (
         SELECT project_info_id,
                SUM(effort_days + buffer_days) AS assigned_days
           FROM effort_estimate
          WHERE emp_id = ?
          GROUP BY project_info_id
       ) e ON e.project_info_id = pi.project_info_id
       LEFT JOIN (
  SELECT projectcategory_code,
         SUM(number_of_hours) AS logged_hours
    FROM hrms_timesheet
   WHERE employee_id = ?
   GROUP BY projectcategory_code
) h ON h.projectcategory_code = pi.sub_category
       WHERE t.project_info_id IS NOT NULL
          OR e.project_info_id IS NOT NULL
       ORDER BY pi.project_info_id`,
      [empId, empId, empId],
    );

    if (rows.length === 0) {
      return res.status(200).json({
        success: true,
        emp_id: empId,
        total_projects: 0,
        total_assigned_days: 0,
        total_logged_hours: 0,
        projects: [],
      });
    }

    // ─── 2. Fetch PMS task details for each project ────────────────────────
    const enriched = await Promise.all(
      rows.map(async (p) => {
        let tasks = [];
        let milestones = [];

        try {
          console.log(
            `\n🔍 Fetching PMS details for project ${p.pms_project_id} (emp=${empId})`,
          );

          const raw = await pmsGet(uatToken, "/api/pms/getProjectDetails", {
            projectId: p.pms_project_id,
          });

          console.log("   RAW keys:", Object.keys(raw || {}));
          console.log(
            "   raw.tasksDetails is array?",
            Array.isArray(raw?.tasksDetails),
          );
          console.log("   raw.tasksDetails length:", raw?.tasksDetails?.length);

          const parsed = extractProjectDetails(raw);
          tasks = parsed.tasks;
          milestones = parsed.milestones;

          console.log("   parsed.tasks length:", tasks.length);
          console.log("   parsed.milestones length:", milestones.length);
          if (tasks.length > 0) {
            console.log("   first task emp_id:", tasks[0].emp_id);
          }
        } catch (err) {
          console.warn(
            `   ❌ PMS fetch FAILED for project ${p.pms_project_id}:`,
            err.message,
          );
        }

        // Filter to this employee's tasks
        const myTasks = tasks.filter((t) => {
          const match = String(t.emp_id).trim() === String(empId).trim();
          if (!match) {
            console.log(
              `   No match: task.emp_id="${t.emp_id}" vs empId="${empId}"`,
            );
          }
          return match;
        });

        const completed = myTasks.filter((t) => t.status === "COMPLETED");
        const inProgress = myTasks.filter((t) => t.status === "STARTED");
        const pending = myTasks.filter((t) => t.status === "YET_TO_START");
        const inactive = myTasks.filter((t) => t.status === "INACTIVE");

        // Compute span of her tasks in this project
        const startDates = myTasks
          .map((t) => t.planned_start_date)
          .filter(Boolean)
          .sort();
        const endDates = myTasks
          .map((t) => t.planned_end_date)
          .filter(Boolean)
          .sort();

        const taskStart = startDates[0] || null;
        const taskEnd = endDates[endDates.length - 1] || null;

        let taskSpanDays = null;
        if (taskStart && taskEnd) {
          taskSpanDays =
            Math.ceil(
              (new Date(taskEnd) - new Date(taskStart)) / (1000 * 60 * 60 * 24),
            ) + 1;
        }

        const actualStarts = myTasks
          .map((t) => t.actual_start_date)
          .filter(Boolean)
          .sort();
        const actualEnds = myTasks
          .map((t) => t.actual_end_date)
          .filter(Boolean)
          .sort();

        const taskActualStart = actualStarts[0] || null;
        const taskActualEnd = actualEnds[actualEnds.length - 1] || null;

        return {
          project_info_id: p.project_info_id,
          pms_project_id: p.pms_project_id,
          project_code: p.project_code,
          project_category_code: p.sub_category,
          description: p.description,

          // Task counts
          assigned_task_count: p.assigned_task_count,
          assigned_units: p.assigned_units,
          completed_tasks: completed.length,
          in_progress_tasks: inProgress.length,
          pending_tasks: pending.length,
          inactive_tasks: inactive.length,
          total_tasks_in_project: myTasks.length,

          // Planned dates (from PMS)
          task_planned_start_date: taskStart,
          task_planned_end_date: taskEnd,
          task_span_days: taskSpanDays,

          // Actual dates (from PMS)
          task_actual_start_date: taskActualStart,
          task_actual_end_date: taskActualEnd,

          // Status summary as an object
          task_status_summary: {
            COMPLETED: completed.length,
            STARTED: inProgress.length,
            YET_TO_START: pending.length,
            INACTIVE: inactive.length,
            other:
              myTasks.length -
              completed.length -
              inProgress.length -
              pending.length -
              inactive.length,
          },

          // Per-task rows for the frontend table
          tasks: myTasks.map((t) => ({
            task_id: t.task_id,
            task_title: t.task_title,
            status: t.status,
            planned_start_date: t.planned_start_date,
            planned_end_date: t.planned_end_date,
            actual_start_date: t.actual_start_date,
            actual_end_date: t.actual_end_date,
            no_days_required: t.no_days_required,
            emp_id: t.emp_id,
            emp_name: t.emp_name,
          })),

          // Effort
          assigned_days: Number(p.assigned_days) || 0,
          assigned_hours: (Number(p.assigned_days) || 0) * HOURS_PER_DAY,

          // Actual logged
          logged_hours: Number(p.logged_hours) || 0,
        };
      }),
    );

    // ─── 3. Roll up totals ─────────────────────────────────────────────────
    const totalAssignedDays = enriched.reduce((s, p) => s + p.assigned_days, 0);
    const totalAssignedHours = enriched.reduce(
      (s, p) => s + p.assigned_hours,
      0,
    );
    const totalLoggedHours = enriched.reduce((s, p) => s + p.logged_hours, 0);

    // Overall span: earliest start → latest end across all her projects
    const allStarts = enriched
      .map((p) => p.task_start_date)
      .filter(Boolean)
      .sort();
    const allEnds = enriched
      .map((p) => p.task_end_date)
      .filter(Boolean)
      .sort();
    const overallStart = allStarts[0] || null;
    const overallEnd = allEnds[allEnds.length - 1] || null;

    let overallSpanDays = null;
    if (overallStart && overallEnd) {
      overallSpanDays =
        Math.ceil(
          (new Date(overallEnd) - new Date(overallStart)) /
            (1000 * 60 * 60 * 24),
        ) + 1;
    }

    // ─── 4. Response ───────────────────────────────────────────────────────
    return res.status(200).json({
      success: true,
      emp_id: empId,
      total_projects: enriched.length,

      totals: {
        total_assigned_days: totalAssignedDays,
        total_assigned_hours: totalAssignedHours,
        total_logged_hours: totalLoggedHours,
      },

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
  getEmployeeUtilization,
  getAllEmployeesUtilization,
};
