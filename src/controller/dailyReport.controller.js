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

    // 3️⃣ Shape + classify
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

    // 4️⃣ Last completed per employee
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

    return res.status(200).json({
      success: true,
      project_id: Number(projectId),
      total_tasks: tasks.length,
      total_milestones: milestones.length,

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
    });
  } catch (err) {
    console.error("❌ fetchProjectTasks error:", err.message);
    const { status, body } = normalizePMSError(err);
    return res.status(status).json(body);
  }
};

module.exports = {
  fetchStoredPmsProjects,
  fetchProjectTasks,
};
