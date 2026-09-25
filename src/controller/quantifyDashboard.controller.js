const { query } = require("../config/db");
const { getUatToken } = require("../../helpers/pmsTokenStore");
const { pmsGet, extractProjects } = require("../../helpers/pmsHelper");

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

module.exports = {
  getDashboardOverview,
};
