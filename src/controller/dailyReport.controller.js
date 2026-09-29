const {
  pmsGet,
  normalizePMSError,
  extractProjects,
  extractProjectDetails,
  toDate,
  shapeTask,
  isDelayed,
} = require("../../helpers/pmsHelper");
const { getUatToken } = require("../../helpers/pmsTokenStore");
const { query, masterQuery } = require("../config/db");

//fetchStoredPmsProjects fetches all PMS projects stored in Quantify's project_info table, classifies them by status, and returns counts and lists.
const fetchStoredPmsProjects = async (req, res) => {
  try {
    // authMiddleware has already verified our own JWT and set req.user.
    // PMS needs the original UAT token cached at login, not our JWT — never
    // forward req.headers.authorization to PMS (see pmsHelper.js).
    const uatToken = getUatToken(req.user?.emp_id);
    if (!uatToken) {
      return res.status(401).json({
        success: false,
        message:
          "PMS session not found or expired. Please log in again to refresh your PMS access.",
      });
    }

    const raw = await pmsGet(uatToken, "/api/pms/getAllProjects");

    const pmsArray = extractProjects(raw);

    // 📦 Base empty response shape (reused for early returns)
    const emptyResponse = {
      success: true,
      counts: {
        all: 0,
        completed: 0,
        inprogress: 0,
        waiting_for_approval: 0,
        rejected: 0,
        on_hold: 0,
        inactive: 0,
      },
      total_from_pms: pmsArray.length,
      total_stored: 0,
      all: [],
      completed: [],
      inprogress: [],
      waiting_for_approval: [],
      rejected: [],
      on_hold: [],
    };

    if (pmsArray.length === 0) {
      return res.status(200).json(emptyResponse);
    }

    // 1️⃣ Filter to only projects stored in Quantify's project_info
    const rows = await query(`SELECT project_id FROM project_info`);
    const storedIds = new Set(rows.map((r) => String(r.project_id).trim()));

    const stored = pmsArray.filter((p) => {
      const id = String(p.project_id ?? p.id ?? "").trim();
      return storedIds.has(id);
    });

    // 2️⃣ Bucket by status (excluding INACTIVE)
    const buckets = {
      completed: [],
      inprogress: [],
      waiting_for_approval: [],
      rejected: [],
      on_hold: [],
    };

    let inactiveCount = 0;

    for (const p of stored) {
      const status = String(p.status || "")
        .toUpperCase()
        .trim();

      switch (status) {
        case "COMPLETED":
          buckets.completed.push(p);
          break;
        case "APPROVED":
          buckets.inprogress.push(p);
          break;
        case "WAITING_FOR_APPROVAL":
          buckets.waiting_for_approval.push(p);
          break;
        case "REJECTED":
          buckets.rejected.push(p);
          break;
        case "ON_HOLD":
          buckets.on_hold.push(p);
          break;
        case "INACTIVE":
          inactiveCount++;
          break;
        default:
          // Unknown statuses are silently ignored (logged for visibility)
          console.warn(
            `⚠️ Unknown project status: "${p.status}" for project_id ${p.project_id}`,
          );
      }
    }

    // 3️⃣ `all` = union of the five buckets (excludes INACTIVE)
    const all = [
      ...buckets.completed,
      ...buckets.inprogress,
      ...buckets.waiting_for_approval,
      ...buckets.rejected,
      ...buckets.on_hold,
    ];

    // 4️⃣ Response
    return res.status(200).json({
      success: true,
      counts: {
        all: all.length,
        completed: buckets.completed.length,
        inprogress: buckets.inprogress.length,
        waiting_for_approval: buckets.waiting_for_approval.length,
        rejected: buckets.rejected.length,
        on_hold: buckets.on_hold.length,
        inactive: inactiveCount, // informational — not returned as a bucket
      },
      total_from_pms: pmsArray.length,
      total_stored: stored.length,
      all,
      ...buckets,
    });
  } catch (err) {
    console.error("❌ fetchStoredPmsProjects error:", err.message);
    const { status, body } = normalizePMSError(err);
    return res.status(status).json(body);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/pms/project-tasks?projectId=639
// Returns tasks of a project classified into buckets.
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Fetch task_info metadata for a given PMS projectId.
 * Returns a Map keyed by task_id → { role, task_type, unit }.
 */
async function getTaskInfoMapByPmsProjectId(pmsProjectId) {
  const rows = await query(
    `SELECT ti.task_id, ti.role, ti.task_type, ti.unit
       FROM task_info ti
       JOIN project_info pi ON pi.project_info_id = ti.project_info_id
      WHERE pi.project_id = ?`,
    [String(pmsProjectId)],
  );

  const map = new Map();
  for (const r of rows) {
    map.set(String(r.task_id), {
      role: r.role,
      task_type: r.task_type,
      unit: r.unit,
    });
  }
  return map;
}
// ─────────────────────────────────────────────────────────────────────────────
// Shapes + classifies a project's raw PMS tasks into the same buckets
// fetchProjectTasks (GET /api/daily-reports/project-tasks) has always returned:
// in_progress / all_completed / not_yet_started / delayed / last_completed_by_employee.
// Extracted so getDailyReportOverview (below) can apply IDENTICAL classification
// rules to a date-scoped subset of a project's tasks, instead of maintaining a
// second, divergent copy of "what counts as delayed" / "what counts as this
// employee's last completed task."
// ─────────────────────────────────────────────────────────────────────────────
function classifyProjectTasks(tasks, taskInfoMap) {
  const in_progress = [];
  const all_completed = [];
  const not_yet_started = [];
  const delayed = [];

  for (const t of tasks) {
    const meta = taskInfoMap.get(String(t.task_id));
    const shaped = shapeTask(t, meta);

    if (t.status === "STARTED") in_progress.push(shaped);
    else if (t.status === "COMPLETED") all_completed.push(shaped);
    else if (t.status === "YET_TO_START") not_yet_started.push(shaped);

    if (isDelayed(t)) delayed.push(shaped);
  }

  // Last completed per employee
  const completedSorted = [...all_completed].sort((a, b) => {
    const da = toDate(a.actual_end_date)?.getTime() || 0;
    const db = toDate(b.actual_end_date)?.getTime() || 0;
    if (db !== da) return db - da;
    return (b.task_id || 0) - (a.task_id || 0);
  });

  const lastCompletedMap = new Map();
  for (const t of completedSorted) {
    if (!lastCompletedMap.has(t.emp_id)) lastCompletedMap.set(t.emp_id, t);
  }
  const last_completed_by_employee = [...lastCompletedMap.values()];

  const all = [...in_progress, ...last_completed_by_employee];

  return {
    counts: {
      YET_TO_START: not_yet_started.length,
      STARTED: in_progress.length,
      COMPLETED: all_completed.length,
      DELAYED: delayed.length,
      ALL: all.length,
    },
    all,
    in_progress,
    all_completed,
    not_yet_started,
    delayed,
    last_completed_by_employee,
  };
}

// fetchProjectTasks fetches tasks of a PMS project, classifies them into buckets, and returns counts and lists.
const fetchProjectTasks = async (req, res) => {
  try {
    const projectId = req.query.projectId || req.params.projectId;

    if (!projectId) {
      return res.status(400).json({
        success: false,
        message: "projectId is required",
      });
    }

    // authMiddleware has already verified our own JWT and set req.user.
    // PMS needs the original UAT token cached at login, not our JWT — never
    // forward req.headers.authorization to PMS (see pmsHelper.js).
    const uatToken = getUatToken(req.user?.emp_id);
    if (!uatToken) {
      return res.status(401).json({
        success: false,
        message:
          "PMS session not found or expired. Please log in again to refresh your PMS access.",
      });
    }

    // 1️⃣ Fetch PMS tasks + milestones
    const raw = await pmsGet(uatToken, "/api/pms/getProjectDetails", {
      projectId,
    });
    const { tasks, milestones } = extractProjectDetails(raw);

    // 2️⃣ Fetch Quantify's task_info metadata (role, task_type, unit)
    const taskInfoMap = await getTaskInfoMapByPmsProjectId(projectId);

    if (tasks.length === 0) {
      return res.status(200).json({
        success: true,
        project_id: projectId,
        total_tasks: 0,
        total_milestones: milestones.length,
        counts: {
          YET_TO_START: 0,
          STARTED: 0,
          COMPLETED: 0,
          DELAYED: 0,
          ALL: 0,
        },
        all: [],
        in_progress: [],
        all_completed: [],
        not_yet_started: [],
        delayed: [],
        last_completed_by_employee: [],
      });
    }

    // 3️⃣ Shape + classify (same rules getDailyReportOverview applies to its date-scoped subset)
    const classified = classifyProjectTasks(tasks, taskInfoMap);

    return res.status(200).json({
      success: true,
      project_id: Number(projectId),
      total_tasks: tasks.length,
      total_milestones: milestones.length,
      ...classified,
    });
  } catch (err) {
    console.error("❌ fetchProjectTasks error:", err.message);
    const { status, body } = normalizePMSError(err);
    return res.status(status).json(body);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/daily-reports/overview?date=YYYY-MM-DD
//
// The Daily Report screen's single combined API: 5 stat cards, the global
// status tabs (All/In Progress/On Hold/Completed), and one card per imported
// project with its own task table — all scoped to ONE calendar day.
//
// Date semantics (confirmed with the user): a task "belongs to" the selected
// day when that day falls inside the task's PLANNED window — i.e.
// planned_start_date <= date <= planned_end_date. A task with no planned
// dates on either side can't be placed on a day, so it's excluded from the
// day's task list (but still counts toward the project's overall, non-date
// -scoped milestone completion %).
//
// "Last Completed" vs "Total Completed" both operate over that SAME
// date-scoped task list (this mirrors ProjectReportCard.jsx's PROJECT_FILTERS,
// which filter one shared `project.tasks` array, not two separate lists):
//   - Total Completed = date-scoped tasks with PMS status COMPLETED
//   - Last Completed  = the subset of those whose actual_end_date IS the
//     selected day (i.e. completed ON that day, not just completed by then)
//
// Dates are formatted here (not left as raw ISO) because every consumer —
// ProjectReportCard.jsx, ReportTaskTable.jsx — already renders date fields as
// plain display strings with no parsing of its own (same contract the mock
// data always had).
// ─────────────────────────────────────────────────────────────────────────────

const MONTHS_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

// PMS timestamps are full ISO strings that are really midnight IST stored as UTC (same quirk
// documented throughout the Import Project code) — UTC getters avoid an IST day-shift.
function dateOnlyUTC(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function formatDisplayDate(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return `${String(d.getUTCDate()).padStart(2, "0")} ${MONTHS_SHORT[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

// Same idea as quantifyDashboard.controller.js's classifyProjectStatus, duplicated (not
// imported) so this file stays independent — see that file's comment for why.
function classifyProjectStatusTag(rawStatus, plannedEndDate) {
  const status = String(rawStatus || "").toUpperCase();
  const completed = status === "COMPLETED";
  let pastDue = false;
  if (plannedEndDate) {
    const end = new Date(plannedEndDate);
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    pastDue = !Number.isNaN(end.getTime()) && end < todayStart;
  }
  if (completed) return "Completed";
  if (pastDue) return "Delayed";
  if (status === "ON_HOLD" || status === "INACTIVE") return "On Hold";
  if (status === "APPROVED" || status === "STARTED") return "In Progress";
  return "On Schedule";
}

const getDailyReportOverview = async (req, res, next) => {
  try {
    const date = req.query.date || dateOnlyUTC(new Date());

    const uatToken = getUatToken(req.user?.emp_id);
    if (!uatToken) {
      return res.status(401).json({
        success: false,
        message:
          "PMS session not found or expired. Please log in again to refresh your PMS access.",
      });
    }

    const localRows = await query(
      `SELECT project_info_id, project_id, project_code FROM project_info`,
    );

    const emptyResponse = {
      success: true,
      date,
      metrics: {
        totalProjects: 0,
        notStartedTasks: 0,
        inProgressTasks: 0,
        lastCompleted: 0,
        totalCompleted: 0,
      },
      global_tabs: [
        { key: "All", label: "All", count: 0 },
        { key: "In Progress", label: "In Progress", count: 0 },
        { key: "On Hold", label: "On Hold", count: 0 },
        { key: "Completed", label: "Completed", count: 0 },
      ],
      projects: [],
    };

    if (localRows.length === 0) {
      return res.status(200).json(emptyResponse);
    }

    // ── One PMS call for project title/status/dates/coordinator, matched by project_id ──
    let pmsProjects = [];
    try {
      const raw = await pmsGet(uatToken, "/api/pms/getAllProjects");
      pmsProjects = extractProjects(raw);
    } catch (pmsErr) {
      console.error(
        "Error fetching PMS projects for daily report:",
        pmsErr.message,
      );
    }
    const pmsByProjectId = new Map(
      pmsProjects.map((p) => [String(p.project_id ?? p.id ?? ""), p]),
    );

    // ── Team size per project (distinct effort_estimate members), one bulk query ──
    const teamRows = await query(
      `SELECT project_info_id, COUNT(DISTINCT emp_id) AS cnt FROM effort_estimate GROUP BY project_info_id`,
    );
    const teamCountByProjectInfoId = new Map(
      teamRows.map((r) => [r.project_info_id, Number(r.cnt) || 0]),
    );

    // ── Per-project PMS tasks + our task_info overlay, run in parallel ──
    const detailResults = await Promise.allSettled(
      localRows.map((row) =>
        pmsGet(uatToken, "/api/pms/getProjectDetails", {
          projectId: row.project_id,
        }),
      ),
    );
    const taskInfoMaps = await Promise.all(
      localRows.map((row) => getTaskInfoMapByPmsProjectId(row.project_id)),
    );

    const totals = {
      notStarted: 0,
      inProgress: 0,
      lastCompleted: 0,
      totalCompleted: 0,
      all: 0,
      blockers: 0,
    };

    const projects = localRows.map((row, index) => {
      const pmsProject = pmsByProjectId.get(String(row.project_id));
      const detailResult = detailResults[index];
      const { tasks: allPmsTasks } =
        detailResult.status === "fulfilled"
          ? extractProjectDetails(detailResult.value)
          : { tasks: [] };
      const taskInfoMap = taskInfoMaps[index];

      // Overall milestone completion — NOT date-scoped, uses every task the project has.
      const completedOverall = allPmsTasks.filter(
        (t) => t.status === "COMPLETED",
      ).length;
      const milestoneCompletion =
        allPmsTasks.length === 0
          ? 0
          : Math.round((completedOverall / allPmsTasks.length) * 100);

      // Date-scoping is DELIBERATELY DISABLED for now — the user hasn't confirmed the exact
      // semantics they want yet ("we are still not confirmed on it, keep it aside"), and the
      // previous planned-window filter (planned_start_date <= date <= planned_end_date) was
      // hiding real data for every project whose dates don't happen to span today, making it
      // impossible to verify the rest of the page against real data. Every project's FULL task
      // list is shown regardless of `date` until this is revisited — do not re-add date filtering
      // here without that confirmation.
      const classified = classifyProjectTasks(allPmsTasks, taskInfoMap);
      const delayedIds = new Set(classified.delayed.map((t) => t.task_id));
      const lastCompletedIds = new Set(
        classified.last_completed_by_employee.map((t) => t.task_id),
      );
      const shapedDayTasks = [
        ...classified.not_yet_started,
        ...classified.in_progress,
        ...classified.all_completed,
      ];

      const dayTasks = shapedDayTasks.map((shaped) => {
        const hasDependency = Boolean(shaped.dependency);
        const isCompleted = shaped.status === "COMPLETED";
        const isInProgress = shaped.status === "STARTED";
        const displayStatus = isCompleted
          ? "Completed"
          : isInProgress
            ? "In Progress"
            : "Not Started";

        const delayedFlag = delayedIds.has(shaped.task_id);
        const isLastCompleted = lastCompletedIds.has(shaped.task_id);
        const dueTodayFlag = dateOnlyUTC(shaped.planned_end_date) === date;

        const classification = isLastCompleted
          ? "LAST COMPLETED"
          : hasDependency
            ? "BLOCKED"
            : isInProgress
              ? "IN PROGRESS"
              : "";

        let actualLine1 = null;
        let actualLine2 = "";
        let varianceBadge = null;
        if (isCompleted) {
          actualLine1 = formatDisplayDate(shaped.actual_end_date);
          const plannedEnd = new Date(shaped.planned_end_date);
          const actualEnd = new Date(shaped.actual_end_date);
          if (
            !Number.isNaN(plannedEnd.getTime()) &&
            !Number.isNaN(actualEnd.getTime())
          ) {
            const diffDays = Math.round(
              (actualEnd.getTime() - plannedEnd.getTime()) / 86400000,
            );
            varianceBadge =
              diffDays > 0
                ? { label: `+${diffDays}d`, type: "warning" }
                : { label: "On time", type: "success" };
          }
        } else if (shaped.actual_start_date) {
          actualLine1 = `${formatDisplayDate(shaped.actual_start_date)} →`;
          actualLine2 = "Running";
          varianceBadge = delayedFlag
            ? { label: "Delayed", type: "warning" }
            : { label: "On track", type: "success" };
        }

        return {
          id: `T-${shaped.task_id}`,
          taskCode: `T-${shaped.task_id}`,
          classification,
          taskName: shaped.task_title || "—",
          ownerName: shaped.emp_name || shaped.emp_id || "—",
          role: shaped.role,
          ownerRole: shaped.role,
          taskType: shaped.task_type,
          unit: shaped.unit,
          // PMS has no task-level risk category yet (same limitation as Task Info) — left
          // null; ReportTaskTable.jsx already shows "NA" for a missing value here.
          riskCategory: null,
          plannedStart: formatDisplayDate(shaped.planned_start_date),
          plannedEnd: formatDisplayDate(shaped.planned_end_date),
          actualLine1,
          actualLine2,
          varianceBadge,
          // No real remarks source yet (needs a place for someone to actually write one) —
          // left null; ReportTaskTable.jsx already shows "—" for a missing value here.
          remarks: null,
          status: displayStatus,
          isBlocker: hasDependency && !isCompleted,
          isDelayed: delayedFlag,
          isDueToday: dueTodayFlag,
        };
      });

      const tabCounts = {
        all: dayTasks.length,
        inProgress: dayTasks.filter((t) => t.status === "In Progress").length,
        notStarted: dayTasks.filter((t) => t.status === "Not Started").length,
        totalCompleted: dayTasks.filter((t) => t.status === "Completed").length,
        lastCompleted: dayTasks.filter(
          (t) => t.classification === "LAST COMPLETED",
        ).length,
        blockers: dayTasks.filter((t) => t.isBlocker).length,
        delayed: dayTasks.filter((t) => t.isDelayed).length,
        dueToday: dayTasks.filter((t) => t.isDueToday).length,
      };

      totals.notStarted += tabCounts.notStarted;
      totals.inProgress += tabCounts.inProgress;
      totals.lastCompleted += tabCounts.lastCompleted;
      totals.totalCompleted += tabCounts.totalCompleted;
      totals.all += tabCounts.all;
      totals.blockers += tabCounts.blockers;

      return {
        id: row.project_info_id,
        name:
          pmsProject?.project_title ||
          pmsProject?.title ||
          `PMS Project ${row.project_id}`,
        projectCode: `PMS-${row.project_id}`,
        statusTag: classifyProjectStatusTag(
          pmsProject?.status,
          pmsProject?.planned_end_date,
        ),
        lead: pmsProject?.project_coordinator || "—",
        teamMembersCount:
          teamCountByProjectInfoId.get(row.project_info_id) || 0,
        timeline: `${formatDisplayDate(pmsProject?.planned_start_date) || "—"} → ${formatDisplayDate(pmsProject?.planned_end_date) || "—"}`,
        activeTasksCount: tabCounts.inProgress,
        milestoneCompletion,
        tabCounts,
        tasks: dayTasks,
      };
    });

    return res.status(200).json({
      success: true,
      date,
      metrics: {
        totalProjects: localRows.length,
        notStartedTasks: totals.notStarted,
        inProgressTasks: totals.inProgress,
        lastCompleted: totals.lastCompleted,
        totalCompleted: totals.totalCompleted,
      },
      global_tabs: [
        { key: "All", label: "All", count: totals.all },
        { key: "In Progress", label: "In Progress", count: totals.inProgress },
        { key: "On Hold", label: "On Hold", count: totals.blockers },
        { key: "Completed", label: "Completed", count: totals.totalCompleted },
      ],
      projects,
    });
  } catch (err) {
    console.error("❌ getDailyReportOverview error:", err.message);
    const { status, body } = normalizePMSError(err);
    return res.status(status).json(body);
  }
};

module.exports = {
  fetchStoredPmsProjects,
  fetchProjectTasks,
  getDailyReportOverview,
};
