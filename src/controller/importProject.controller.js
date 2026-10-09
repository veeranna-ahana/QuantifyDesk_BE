const { query, quantifyPool, ahanaPilotQuery } = require("../config/db");
const { getUatToken } = require("../../helpers/pmsTokenStore");
const {
  pmsGet,
  extractProjects,
  normalizePMSError,
} = require("../../helpers/pmsHelper");
const {
  PROJECT_TYPES,
  DEFAULT_PROJECT_TYPE,
} = require("../constants/projectTypes");
const { HRS_PER_DAY } = require("../constants/effort");
const {
  fetchCategoryTimesheetsGroupedByEmployee,
} = require("./projectTimesheet.controller");
const {
  getActiveEmployeesFromHRMS,
  getEmployeeNameMapFromHRMS,
} = require("./hrms.controller");

// ============================================================================
// Import Project — Step 1 (Project Info)
//
// New controller, kept separate from project.controller.js on purpose so the
// existing /api/projects routes are left untouched. This is a plain
// pass-through GET to the external PMS API — no DB involved.
//
// PMS calls go through helpers/pmsHelper.js's pmsGet, not a direct axios
// call — that's the same shared helper dailyReport.controller.js uses, so
// every PMS-calling controller in the app now goes through one place
// instead of each reimplementing its own axios/PMS_CONFIG/headers. The
// auth pattern itself is unchanged: still getUatToken(emp_id) from
// pmsTokenStore.js, never the client's Authorization header — see
// pmsHelper.js's own comments for why.
// ============================================================================

// Maps PMS's own task status values straight to our three buckets. Confirmed against a real
// getProjectDetails response — PMS only ever sends exactly "COMPLETED", "STARTED", or
// "YET_TO_START" for a task's `status` (never the word "progress" or "done" anywhere), so the
// previous loose `.includes("progress")` check never matched "STARTED" and silently miscounted
// every in-progress task as "Not Started". This now matches PMS's real values exactly.
function normalizeTaskStatus(rawStatus) {
  const status = String(rawStatus || "").toUpperCase();

  if (status === "COMPLETED") {
    return "completed";
  }
  if (status === "STARTED") {
    return "in_progress";
  }
  // Covers "YET_TO_START" and anything else PMS might send that isn't one of the two above —
  // never fabricated as completed/in-progress, just bucketed as not started.
  return "not_started";
}

// ─────────────────────────────────────────────────────────────────────────
// Computes the Task Info screen's summary strip (Milestones X/Y Completed,
// Tasks N, Completed/In Progress/Not Started counts) and each milestone's
// own completion percentage — entirely from the same milestoneDetails/
// tasksDetails PMS already returned. Nothing here is persisted; status is
// PMS-owned and can change on their side, so this is recomputed on every
// pms-sync call, same as the rest of this endpoint's data.
//
// Confirmed against the real PMS getProjectDetails sample: a task links to
// its milestone via `project_milestone_id` (matching the milestone's own
// `milestone_id`), and a milestone's display name is `milestone_title`
// (not `milestone_name`).
// ─────────────────────────────────────────────────────────────────────────
function computeTaskStats(milestoneDetails, tasksDetails) {
  const tasksByMilestoneId = new Map();

  for (const task of tasksDetails) {
    const milestoneId = String(task.project_milestone_id ?? "");
    if (!tasksByMilestoneId.has(milestoneId)) {
      tasksByMilestoneId.set(milestoneId, []);
    }
    tasksByMilestoneId.get(milestoneId).push(task);
  }

  let completedTasks = 0;
  let inProgressTasks = 0;
  let notStartedTasks = 0;

  for (const task of tasksDetails) {
    const bucket = normalizeTaskStatus(task.status);
    if (bucket === "completed") completedTasks += 1;
    else if (bucket === "in_progress") inProgressTasks += 1;
    else notStartedTasks += 1;
  }

  const milestones = milestoneDetails.map((milestone) => {
    const milestoneId = String(milestone.milestone_id ?? "");
    const tasksForMilestone = tasksByMilestoneId.get(milestoneId) || [];
    const totalTasks = tasksForMilestone.length;
    const completedForMilestone = tasksForMilestone.filter(
      (t) => normalizeTaskStatus(t.status) === "completed",
    ).length;

    const percentage =
      totalTasks === 0
        ? 0
        : Math.round((completedForMilestone / totalTasks) * 100);

    const milestoneStatus =
      totalTasks === 0
        ? "Not Started"
        : percentage === 100
          ? "Completed"
          : completedForMilestone > 0 ||
              tasksForMilestone.some(
                (t) => normalizeTaskStatus(t.status) === "in_progress",
              )
            ? "In Progress"
            : "Not Started";

    return {
      milestone_id: milestone.milestone_id,
      milestone_name: milestone.milestone_title,
      total_tasks: totalTasks,
      completed_tasks: completedForMilestone,
      percentage,
      status: milestoneStatus,
    };
  });

  const completedMilestones = milestones.filter(
    (m) => m.status === "Completed",
  ).length;

  return {
    milestones: {
      total: milestones.length,
      completed: completedMilestones,
      percentage:
        milestones.length === 0
          ? 0
          : Math.round((completedMilestones / milestones.length) * 100),
    },
    tasks: {
      total: tasksDetails.length,
      completed: completedTasks,
      in_progress: inProgressTasks,
      not_started: notStartedTasks,
    },
    milestoneBreakdown: milestones,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Converts an effort_estimate row's days into hours at HRS_PER_DAY, rounded to 2 decimals
// (days can be fractional, e.g. 12.5). Used on create/update so the *_hours columns are
// stored, not just derived at read time — see effort_estimate_hours.sql migration notes.
// ─────────────────────────────────────────────────────────────────────────
function computeEffortHours(effortDays, bufferDays) {
  const round2 = (n) => Math.round(n * 100) / 100;
  const effortHours = round2((Number(effortDays) || 0) * HRS_PER_DAY);
  const bufferHours = round2((Number(bufferDays) || 0) * HRS_PER_DAY);
  return {
    effortHours,
    bufferHours,
    totalHours: round2(effortHours + bufferHours),
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Mirrors role/task_type/unit into PMS's own DB (ahana_pilot.milestone_tasks), keyed by
// task_id (PMS's own task id — the same value we store as task_info.task_id / send as
// pms_task_id). This is a SEPARATE database/server from quantify, so it can't join the
// quantify transaction — it's written best-effort right after the quantify commit succeeds.
// A failure here does NOT fail the request (our own DB already has the authoritative data),
// but every failure is collected and returned to the caller as `pms_sync_warnings`, never
// silently swallowed — same "never hide a failure behind an empty/default value" rule as the
// Daily Report fetchError flag.
// ─────────────────────────────────────────────────────────────────────────
async function syncTasksToAhanaPilot(tasks) {
  const warnings = [];

  for (const task of tasks) {
    const { pms_task_id, role, task_type, unit } = task;
    if (!pms_task_id) continue;

    try {
      const result = await ahanaPilotQuery(
        `UPDATE milestone_tasks
            SET role = ?, task_type = ?, unit = ?
          WHERE task_id = ?`,
        [role || null, task_type || null, unit || null, pms_task_id],
      );
      if (!result || result.affectedRows === 0) {
        warnings.push(
          `PMS task_id ${pms_task_id}: no matching row in ahana_pilot.milestone_tasks — role/task_type/unit not mirrored to PMS.`,
        );
      }
    } catch (err) {
      console.error(
        `Error mirroring task ${pms_task_id} to ahana_pilot.milestone_tasks:`,
        err.message,
      );
      warnings.push(
        `PMS task_id ${pms_task_id}: failed to update ahana_pilot.milestone_tasks (${err.message}).`,
      );
    }
  }

  return warnings;
}

// ─────────────────────────────────────────────────────────────────────────
// GET /api/import-project/pms-project-titles
//
// Step 1's PMS ID text input is replaced by a searchable dropdown of PMS
// project TITLES, not raw project IDs — because PMS creates a brand-new
// project_id for every new VERSION of the same project (e.g. 1101 →
// 1106 when a new version is approved), flipping the old id's status to
// INACTIVE. A title survives across versions; a numeric id doesn't. This
// returns every distinct project_title from PMS's getAllProjects, regardless
// of that title's current version's status (unresolvable/non-APPROVED
// titles are still shown here — the existing APPROVED-only gate in
// syncPmsProject below is what actually blocks syncing one of those).
// ─────────────────────────────────────────────────────────────────────────
const getPmsProjectTitles = async (req, res) => {
  try {
    const empId = req.user?.emp_id;
    const uatToken = getUatToken(empId);
    if (!uatToken) {
      return res.status(401).json({
        message:
          "PMS session not found or expired. Please log in again to refresh your PMS access.",
      });
    }

    const raw = await pmsGet(uatToken, "/api/pms/getAllProjects");
    const projects = extractProjects(raw);

    // Dedup by title — the same title legitimately appears once per PMS version
    // (old + new project_id), and only the title itself is shown here.
    const titles = [
      ...new Set(projects.map((p) => p.project_title).filter(Boolean)),
    ].sort((a, b) => a.localeCompare(b));

    return res.status(200).json({ titles });
  } catch (err) {
    console.error("Error fetching PMS project titles:", err.message);
    const { status, body } = normalizePMSError(err);
    return res.status(status).json(body);
  }
};

// ─────────────────────────────────────────────────────────────────────────
// GET /api/import-project/pms-project-id-by-title?project_title=X
//
// Resolves a chosen title to PMS's CURRENT (latest-version) project_id, via
// PMS's own /api/pms/getProjectIdByTitle. This is the id Step 1 then syncs
// with (syncPmsProject below) and the one that ultimately gets stored in
// project_info.project_id and used everywhere downstream.
// ─────────────────────────────────────────────────────────────────────────
const getPmsProjectIdByTitle = async (req, res) => {
  try {
    const { project_title } = req.query;
    if (!project_title) {
      return res.status(400).json({ message: "project_title is required" });
    }

    const empId = req.user?.emp_id;
    const uatToken = getUatToken(empId);
    if (!uatToken) {
      return res.status(401).json({
        message:
          "PMS session not found or expired. Please log in again to refresh your PMS access.",
      });
    }

    const raw = await pmsGet(uatToken, "/api/pms/getProjectIdByTitle", {
      project_title,
    });
    const projects = extractProjects(raw);
    const match = projects[0];

    if (!match?.project_id) {
      return res.status(404).json({
        message: `No PMS project found for title "${project_title}".`,
      });
    }

    return res.status(200).json({
      project_id: match.project_id,
      project_title: match.project_title || project_title,
      status: match.status || null,
    });
  } catch (err) {
    console.error("Error resolving PMS project id by title:", err.message);
    const { status, body } = normalizePMSError(err);
    return res.status(status).json(body);
  }
};

// ─────────────────────────────────────────────────────────────────────────
// GET /api/import-project/pms-sync?projectId=X
// Calls PMS getProjectDetails and returns projectDetails as-is (same
// pass-through style as fetchPMSProjectDetails in project.controller.js),
// plus milestoneDetails/tasksDetails so the frontend has them ready for
// Step 2 without a second PMS round-trip, and a computed `stats` block for
// the Task Info screen's summary strip + per-milestone percentages.
// ─────────────────────────────────────────────────────────────────────────
const syncPmsProject = async (req, res, next) => {
  try {
    const { projectId } = req.query;

    if (!projectId) {
      return res
        .status(400)
        .json({ message: "projectId (PMS project ID) is required" });
    }

    // authMiddleware has already verified our own JWT and set req.user.
    // Look up the UAT token cached at login for this user — PMS needs
    // THIS token, not our JWT.
    const empId = req.user?.emp_id;
    const uatToken = getUatToken(empId);
    if (!uatToken) {
      return res.status(401).json({
        message:
          "PMS session not found or expired. Please log in again to refresh your PMS access.",
      });
    }

    const data = await pmsGet(uatToken, "/api/pms/getProjectDetails", {
      projectId,
    });

    const { projectDetails, milestoneDetails, tasksDetails } = data || {};

    // PMS doesn't always 404 for a bad/non-existent project ID — for some
    // invalid IDs it responds 200 with an empty/near-empty object instead
    // of throwing. Treat "no real project data came back" the same as a
    // 404, whichever shape PMS used, so the frontend gets one consistent,
    // clear error either way.
    const hasProjectData =
      projectDetails &&
      typeof projectDetails === "object" &&
      Object.keys(projectDetails).length > 0 &&
      (projectDetails.project_id || projectDetails.project_name);

    if (!hasProjectData) {
      return res.status(404).json({
        message: `No project found in PMS for project ID "${projectId}". Please check the ID and try again.`,
      });
    }

    // Only an APPROVED PMS project can be imported — anything else (INACTIVE, ON_HOLD,
    // WAITING_FOR_APPROVAL, REJECTED, COMPLETED, etc.) is rejected here, before any of its data
    // is sent back, so the frontend never has PMS data to populate Steps 1-4 with in the first
    // place (the popup + "no data populated" requirement is enforced by simply not returning it).
    const pmsStatus = String(projectDetails.status || "").toUpperCase();
    if (pmsStatus !== "APPROVED") {
      return res.status(409).json({
        message: `This PMS project's status is "${projectDetails.status || "Unknown"}" — only APPROVED projects can be synced/imported.`,
        pms_status: projectDetails.status || null,
      });
    }

    const safeMilestones = milestoneDetails || [];
    const safeTasks = tasksDetails || [];

    return res.status(200).json({
      projectDetails,
      milestoneDetails: safeMilestones,
      tasksDetails: safeTasks,
      stats: computeTaskStats(safeMilestones, safeTasks),
    });
  } catch (err) {
    console.error("Error syncing PMS project:", err.message);

    if (err.response) {
      if (err.response.status === 401) {
        return res.status(401).json({
          message:
            "PMS session expired or invalid. Please log in again to refresh your PMS access.",
        });
      }
      if (err.response.status === 404) {
        return res.status(404).json({
          message: `No project found in PMS for project ID "${req.query.projectId}". Please check the ID and try again.`,
        });
      }
      // Any other PMS-side status (400/422/etc for a malformed ID, 500 on
      // their end) — surface PMS's own message when it sent one, instead
      // of always falling through to a generic 500.
      return res.status(err.response.status).json({
        message:
          err.response.data?.message ||
          "PMS API returned an error while fetching project details.",
      });
    }

    if (err.code === "ECONNABORTED") {
      return res.status(504).json({
        message:
          "PMS API timed out while fetching project details. Please try again.",
      });
    }

    if (err.code === "ENOTFOUND" || err.code === "ECONNREFUSED") {
      return res.status(503).json({
        message: "PMS API is currently unreachable. Please try again later.",
      });
    }

    return res.status(500).json({
      message: "Failed to fetch project details from PMS",
      error: err.message,
    });
  }
};

// ─────────────────────────────────────────────────────────────────────────
// GET /api/import-project/roles
// Step 3 (Effort Estimate) groups members under role headers — BA, UI,
// TL, FE Dev, BE Dev, Tester. Those headers come from role_task_catalog
// (an existing reference table, not something new), not PMS.
// Returns the distinct role list only — not the task_name/unit_type rows,
// those belong to a later "task catalog for this role" lookup if/when
// Step 3 needs the per-role task breakdown too.
// ─────────────────────────────────────────────────────────────────────────
const getRoles = async (req, res, next) => {
  try {
    const rows = await query(
      `SELECT DISTINCT role FROM role_task_catalog ORDER BY role ASC`,
    );

    const roles = rows.map((r) => r.role);

    return res.status(200).json({ roles });
  } catch (err) {
    return next(err);
  }
};

// ─────────────────────────────────────────────────────────────────────────
// GET /api/import-project/task-catalog?role=BA
// Task Info's Edit Task Details drawer (and Bulk Update) needs the Task
// Type dropdown to depend on the selected Role — e.g. role=BA returns
// ["BA-BRD", "BA-TDD", "BA-Requirements Sign Off", ...], role=UI returns
// ["UI design/ Figma", "UI Review", "UI Signoff"], all straight from
// role_task_catalog.task_name for that role, in the table's own row order.
// ─────────────────────────────────────────────────────────────────────────
const getTaskCatalogByRole = async (req, res, next) => {
  try {
    const { role } = req.query;

    if (!role) {
      return res.status(400).json({ message: "role is required" });
    }

    const rows = await query(
      `SELECT task_name, unit_type
         FROM role_task_catalog
        WHERE role = ?
        ORDER BY id ASC`,
      [role],
    );

    return res.status(200).json({
      taskTypes: rows.map((r) => r.task_name),
    });
  } catch (err) {
    return next(err);
  }
};

// ─────────────────────────────────────────────────────────────────────────
// GET /api/import-project/employees
// Effort Estimate (Step 3)'s "+ Add Member" picker — active employees from
// HRMS (the same source the Timesheet Data tab uses — see hrms.controller.js), not the master
// DB's emp table — per request, this list must reflect HRMS's active-employee roster rather than
// master.emp. Only emp_id + emp_name are returned; effort_estimate stores emp_id only and this
// name is re-joined live at read time (getProjectView), same principle as PMS-owned data never
// being persisted here.
// ─────────────────────────────────────────────────────────────────────────
const getActiveEmployees = async (req, res, next) => {
  try {
    const employees = await getActiveEmployeesFromHRMS();
    return res.status(200).json({ employees });
  } catch (err) {
    return next(err);
  }
};

// ─────────────────────────────────────────────────────────────────────────
// GET /api/import-project/me
// Resolves the logged-in user's display name from their own JWT's emp_id —
// this is the SAME lookup Create Project uses server-side to stamp
// document_checklist.uploaded_by, so the frontend's optimistic "Uploaded by
// <you>" preview (shown before Create Project is even submitted) is
// guaranteed to match what actually gets persisted, instead of depending on
// whatever happens to be sitting in the frontend's Redux/cookie auth state
// (which varies by which login path was used and isn't always kept in sync
// with a fresh emp_name).
// ─────────────────────────────────────────────────────────────────────────
const getCurrentUser = async (req, res, next) => {
  try {
    const empId = req.user?.emp_id;
    if (!empId) {
      return res.status(401).json({ message: "No emp_id on token" });
    }

    const empNameMap = await getEmployeeNameMapFromHRMS();

    return res
      .status(200)
      .json({ emp_id: empId, emp_name: empNameMap.get(String(empId)) || null });
  } catch (err) {
    return next(err);
  }
};

// ─────────────────────────────────────────────────────────────────────────
// GET /api/import-project/project-types
// Project Info (Step 1) needs a Project Type dropdown, but the 3 allowed
// values are maintained here in the backend — a plain const list in
// src/constants/projectTypes.js, not a DB table — rather than hardcoded on
// the frontend, so they can be changed without a frontend deploy.
// ─────────────────────────────────────────────────────────────────────────
const getProjectTypes = (req, res) => {
  return res.status(200).json({
    projectTypes: PROJECT_TYPES,
    defaultProjectType: DEFAULT_PROJECT_TYPE,
  });
};

// ─────────────────────────────────────────────────────────────────────────
// GET /api/import-project/documents
// Step 4 (Document Checklist) shows the fixed set of 16 document types
// (BRD or CR, Proposal Document, ... GIT Repository Link) from
// document_master — the master/reference list, not project-specific.
// Each row here just becomes a "Pending" checklist entry on the frontend
// until the user adds a SharePoint link for it (that link is what gets
// persisted per-project, into document_checklist, on Create Project).
// ─────────────────────────────────────────────────────────────────────────
const getDocumentMaster = async (req, res, next) => {
  try {
    const documents = await query(
      `SELECT document_id, document_name FROM document_master ORDER BY document_id ASC`,
    );

    return res.status(200).json({ documents });
  } catch (err) {
    return next(err);
  }
};

// ─────────────────────────────────────────────────────────────────────────
// POST /api/import-project
// Final step of the wizard — persists everything gathered across Steps
// 1-4 in one call. Only fields we actually own get written:
//   - project_info: our local annotations against the PMS project (the
//     PMS project itself is never re-fetched/stored here — Step 1 already
//     showed it, this just records the PMS project_id + our own fields)
//   - task_info: per-task role/task_type/unit/emp_id overlay rows against
//     PMS task IDs — role/task_type/unit/emp_id are all optional here,
//     since a task can be created without Edit Task Details filled in
//     (that's a later upsert-style "Edit Task Details" endpoint)
//   - effort_estimate: role/effort rows for Step 3
//   - document_checklist: only rows where a sharepoint_url was actually
//     provided — an unfilled document just stays "Pending" and gets no
//     row until the user adds a link (via this API on create, or the
//     future edit/upsert endpoint)
//
// Wrapped in a single DB transaction: if anything fails, nothing is
// persisted — we don't want a project_info row with no matching tasks.
// ─────────────────────────────────────────────────────────────────────────
const createProjectInfo = async (req, res, next) => {
  const {
    pms_project_id,
    pms_project_title,
    project_info = {},
    tasks = [],
    effort_estimates = [],
    documents = [],
  } = req.body || {};

  if (!pms_project_id) {
    return res.status(400).json({ message: "pms_project_id is required" });
  }

  const { project_type, nbd_id, o2d_id, project_code, sub_category } =
    project_info;

  const uploadedBy = req.user?.emp_id || null;

  let connection;
  try {
    connection = await quantifyPool.getConnection();
    await connection.beginTransaction();

    // ── project_info ────────────────────────────────────────────────────
    // description is a PMS field, non-editable here — not stored, always
    // read live from PMS's projectDetails at read-time instead.
    const [projectResult] = await connection.execute(
      `INSERT INTO project_info
         (project_id, project_title, project_type, nbd_id, o2d_id, project_code, sub_category)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        pms_project_id,
        pms_project_title || null,
        project_type || null,
        nbd_id || null,
        o2d_id || null,
        project_code || null,
        sub_category || null,
      ],
    );

    const projectInfoId = projectResult.insertId;

    // ── task_info ────────────────────────────────────────────────────────
    // Only role/task_type/unit (+emp_id) are ours to store — risk_category,
    // remark and allocation all come from PMS and are read-only here, never
    // persisted, same as task title/dates/status.
    for (const task of tasks) {
      const { pms_task_id, emp_id, role, task_type, unit } = task;

      if (!pms_task_id) {
        continue; // task_id is the only thing we can't do without
      }

      await connection.execute(
        `INSERT INTO task_info
           (project_info_id, task_id, emp_id, role, task_type, unit)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          projectInfoId,
          pms_task_id,
          emp_id || null,
          role || null,
          task_type || null,
          unit || null,
        ],
      );
    }

    // ── effort_estimate ─────────────────────────────────────────────────
    // effort_hours/buffer_hours/total_hours are computed from effort_days/buffer_days *
    // HRS_PER_DAY and stored alongside them (see computeEffortHours below) — not just derived
    // at read time — so a historical estimate's hours stay correct even if HRS_PER_DAY changes.
    for (const estimate of effort_estimates) {
      const { emp_id, role, effort_days, buffer_days } = estimate;

      if (!emp_id || !role) {
        continue; // an effort row with no member/role attached to it isn't useful
      }

      const { effortHours, bufferHours, totalHours } = computeEffortHours(
        effort_days,
        buffer_days,
      );

      await connection.execute(
        `INSERT INTO effort_estimate
           (project_info_id, emp_id, role, effort_days, effort_hours, buffer_days, buffer_hours, total_hours)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          projectInfoId,
          emp_id,
          role,
          effort_days ?? null,
          effortHours,
          buffer_days ?? null,
          bufferHours,
          totalHours,
        ],
      );
    }

    // ── document_checklist ──────────────────────────────────────────────
    // A document is either one of the 16 fixed document_master rows (document_id set, name
    // never duplicated here — joined from document_master at read time) OR a custom one added
    // via "Add Document" on the frontend (document_id null, name stored directly in
    // custom_document_name since there's no master row to join to) — either is a valid row
    // here, so this only requires a link + ONE of the two identifiers, not document_id
    // specifically (that was the bug: a custom document has no document_id at all, so it was
    // being silently skipped here every time).
    for (const doc of documents) {
      const { document_id, document_name, sharepoint_url } = doc;

      if (!sharepoint_url || (!document_id && !document_name)) {
        continue; // no link yet -> stays "Pending" on the frontend, no row needed
      }

      await connection.execute(
        `INSERT INTO document_checklist
           (project_info_id, document_id, custom_document_name, sharepoint_url, status, uploaded_by, uploaded_date)
         VALUES (?, ?, ?, ?, 'Uploaded', ?, NOW())`,
        [
          projectInfoId,
          document_id || null,
          document_id ? null : document_name || null,
          sharepoint_url,
          uploadedBy,
        ],
      );
    }

    await connection.commit();

    // Mirror role/task_type/unit into PMS's own DB — best-effort, after our own commit has
    // already succeeded (see syncTasksToAhanaPilot's comment for why this can't be part of
    // the same transaction).
    const pmsSyncWarnings = await syncTasksToAhanaPilot(tasks);

    return res.status(201).json({
      message: "Project imported successfully",
      project_info_id: projectInfoId,
      pms_project_id,
      ...(pmsSyncWarnings.length ? { pms_sync_warnings: pmsSyncWarnings } : {}),
    });
  } catch (err) {
    if (connection) {
      await connection.rollback();
    }

    console.error("Error creating imported project:", err.message);

    if (err.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        message: "This project has already been imported",
        error: err.message,
      });
    }

    if (
      err.code === "ER_NO_REFERENCED_ROW" ||
      err.code === "ER_NO_REFERENCED_ROW_2"
    ) {
      return res.status(400).json({
        message:
          "Invalid reference in payload (check document_id/task_id values)",
        error: err.message,
      });
    }

    return res.status(500).json({
      message: "Failed to create imported project",
      error: err.message,
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
};

// ─────────────────────────────────────────────────────────────────────────
// GET /api/import-project
// Powers the Projects table/listing screen for imported projects. Our DB
// only ever stores project_id (the PMS ID) + fields we own — never the
// project name, customer, status or dates, since those belong to PMS and
// can change on their side independent of us. So this reads our own
// project_info rows first (that's what decides which PMS projects have
// been imported), then does ONE PMS getAllProjects call and merges each
// row's live PMS fields in by project_id, rather than calling
// getProjectDetails per-project.
// ─────────────────────────────────────────────────────────────────────────
const getImportedProjects = async (req, res, next) => {
  try {
    const localRows = await query(
      `SELECT project_info_id, project_id, project_title, project_type, nbd_id, o2d_id,
              project_code, sub_category, created_at
         FROM project_info
        ORDER BY project_info_id DESC`,
    );

    if (localRows.length === 0) {
      return res.status(200).json({ projects: [] });
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

    let pmsProjects = [];
    try {
      const data = await pmsGet(uatToken, "/api/pms/getAllProjects");
      pmsProjects = extractProjects(data);
    } catch (pmsErr) {
      console.error("Error fetching PMS projects for listing:", pmsErr.message);
      // Fall through with pmsProjects = [] — we still show local rows below,
      // just without the PMS-owned fields, instead of failing the whole list.
    }

    const pmsByProjectId = new Map(
      pmsProjects.map((p) => [String(p.project_id || p.id), p]),
    );

    const projects = localRows.map((row) => {
      const pmsProject = pmsByProjectId.get(String(row.project_id));

      return {
        project_info_id: row.project_info_id,
        project_id: row.project_id,
        // ── PMS-owned (live, falls back to the title stored at import time if the live PMS
        // call failed above, or this row's project_id has since gone INACTIVE) ─────────────
        project_title:
          pmsProject?.project_title ||
          pmsProject?.title ||
          row.project_title ||
          null,
        customer_name: pmsProject?.customer_name || null,
        status: pmsProject?.status || null,
        planned_start_date: pmsProject?.planned_start_date || null,
        planned_end_date: pmsProject?.planned_end_date || null,
        actual_start_date: pmsProject?.actual_start_date || null,
        actual_end_date: pmsProject?.actual_end_date || null,
        description: pmsProject?.description || null,
        // Confirmed against a real getAllProjects response: project_coordinator is present
        // on list items too (not just getProjectDetails), and maps to the Projects table's
        // "Owner" column.
        project_coordinator: pmsProject?.project_coordinator || null,
        // ── Locally owned ─────────────────────────────────────────────
        project_type: row.project_type,
        nbd_id: row.nbd_id,
        o2d_id: row.o2d_id,
        project_code: row.project_code,
        sub_category: row.sub_category,
        created_at: row.created_at,
      };
    });

    return res.status(200).json({ projects });
  } catch (err) {
    return next(err);
  }
};

// ─────────────────────────────────────────────────────────────────────────
// GET /api/import-project/:projectInfoId
// Powers the "View" screen (Action → View icon on the Projects table) —
// still keyed by OUR project_info_id (that's what identifies "which
// imported project"), but each tab now merges in whatever it actually
// needs, from wherever that data actually lives:
//
//   - Project Info tab: PMS's projectDetails (project name, customer,
//     presale ID, start/end date, project status, description — all live,
//     PMS-owned, non-editable) merged with our own project_info row
//     (project type, NBD ID, O2D ID, project code, sub category —
//     locally owned)
//   - Task Info tab: PMS's milestoneDetails + tasksDetails (title, owner,
//     planned/actual dates, dependency, status, risk_category, remark,
//     allocation — ALL live/PMS-owned) grouped by milestone, each task
//     overlaid with our task_info row (role, task_type, unit — the only
//     three fields we actually store and let the user edit). Per-milestone
//     + overall stats (completed/in-progress/not-started, percentages)
//     computed the same way as pms-sync's `stats` block. role_task_catalog
//     itself isn't embedded here — that reference data powers the
//     Role/Task Type dropdowns when editing a row, and the frontend
//     already has it via GET /import-project/roles
//   - Effort Estimate tab: plain read of our effort_estimate rows
//   - Document Checklist tab: all 16 document_master rows LEFT JOINed
//     with our document_checklist rows
//
// Timesheet Data tab is still left out, per earlier instruction.
// ─────────────────────────────────────────────────────────────────────────
const getProjectView = async (req, res, next) => {
  try {
    const { projectInfoId } = req.params;

    const projectRows = await query(
      `SELECT project_info_id, project_id, project_title, project_type, nbd_id, o2d_id,
              project_code, sub_category, created_at
         FROM project_info
        WHERE project_info_id = ?`,
      [projectInfoId],
    );

    if (projectRows.length === 0) {
      return res.status(404).json({ message: "Imported project not found" });
    }

    const project = projectRows[0];

    // One PMS call serves the Project Info tab AND the Task Info tab —
    // getProjectDetails already returns projectDetails, milestoneDetails
    // and tasksDetails together, same as pms-sync.
    const empId = req.user?.emp_id;
    const uatToken = getUatToken(empId);

    let projectDetails = null;
    let milestoneDetails = [];
    let tasksDetails = [];

    if (uatToken) {
      try {
        const data = await pmsGet(uatToken, "/api/pms/getProjectDetails", {
          projectId: project.project_id,
        });

        projectDetails = data?.projectDetails || null;
        milestoneDetails = data?.milestoneDetails || [];
        tasksDetails = data?.tasksDetails || [];
      } catch (pmsErr) {
        console.error(
          "Error fetching PMS project details for view:",
          pmsErr.message,
        );
        // Fall through with nulls/empty arrays — the PMS-owned parts of
        // each tab render blank/null rather than failing the whole view.
      }
    }

    // ── Project Info tab ─────────────────────────────────────────────────
    const projectInfoTab = {
      project_info_id: project.project_info_id,
      // ── PMS-owned (live, never persisted by us) ──────────────────────
      pms_id: project.project_id,
      // Prefers the LIVE PMS title, falling back to the title we stored at import time when the
      // live getProjectDetails call fails or the stored project_id has since gone INACTIVE
      // (a new PMS version minting a new project_id) — never fabricated, just the best real
      // value we have between the two sources.
      project_name:
        projectDetails?.project_title ||
        projectDetails?.title ||
        project.project_title ||
        null,
      customer_name: projectDetails?.customer_name || null,
      presale_id:
        projectDetails?.presales_id || projectDetails?.presale_id || null,
      start_date: projectDetails?.planned_start_date || null,
      end_date: projectDetails?.planned_end_date || null,
      // Explicit planned vs actual — `start_date`/`end_date` above are kept as-is (Project
      // Info tab's single Start/End Date fields already read those, and have always meant
      // "planned"), but Project Overview's two date cards need both, clearly distinguished,
      // instead of only ever showing the planned pair under a plain "Start Date"/"End Date"
      // label. Same PMS project object, just the actual_* fields alongside the planned ones —
      // null (not guessed) if PMS hasn't recorded an actual date yet (e.g. project not started).
      planned_start_date: projectDetails?.planned_start_date || null,
      planned_end_date: projectDetails?.planned_end_date || null,
      actual_start_date: projectDetails?.actual_start_date || null,
      actual_end_date: projectDetails?.actual_end_date || null,
      project_status: projectDetails?.status || null,
      description: projectDetails?.description || null,
      project_coordinator: projectDetails?.project_coordinator || null,
      // ── Locally owned ─────────────────────────────────────────────────
      project_type: project.project_type,
      nbd_id: project.nbd_id,
      o2d_id: project.o2d_id,
      project_code: project.project_code,
      sub_category: project.sub_category,
      created_at: project.created_at,
    };

    // ── Task Info tab ────────────────────────────────────────────────────
    const taskInfoRows = await query(
      `SELECT task_id, emp_id, role, task_type, unit
         FROM task_info
        WHERE project_info_id = ?`,
      [projectInfoId],
    );
    const taskInfoByTaskId = new Map(
      taskInfoRows.map((row) => [String(row.task_id), row]),
    );

    // Confirmed against the real PMS sample: a task links to its milestone
    // via `project_milestone_id` (matching the milestone's `milestone_id`),
    // the milestone's display name is `milestone_title`, and the assignee
    // is `emp_name` (falling back to `emp_id`) — PMS has no `owner` field.
    // risk_category/remark/allocation are also PMS-owned and live, read-only — not in the
    // sample payload we've seen, so the keys below (`risk_category`, `remark`, `allocation`)
    // are a best guess pending confirmation of the exact field names PMS actually uses.
    const tasksByMilestoneId = new Map();
    for (const task of tasksDetails) {
      const milestoneId = String(task.project_milestone_id ?? "");
      if (!tasksByMilestoneId.has(milestoneId)) {
        tasksByMilestoneId.set(milestoneId, []);
      }
      tasksByMilestoneId.get(milestoneId).push(task);
    }

    // "Last Completed" — same rule as Daily Reports' classifyProjectTasks (dailyReport.controller.js):
    // among a project's COMPLETED tasks, the most recently completed task PER EMPLOYEE (by
    // actual_end_date, ties broken by the higher task_id) is that employee's "last completed"
    // task. Computed project-wide (across every milestone) before the per-milestone task mapping
    // below, then applied to each task as `is_last_completed` so Task Info's table can flag it
    // exactly like Daily Report's task table does. Grouped by PMS's own raw assignee (t.emp_id
    // from tasksDetails), not task_info's locally-owned role overlay, since "last completed"
    // is about who actually did the work, not who a role tag was later assigned to.
    const completedByRecency = tasksDetails
      .filter((t) => t.status === "COMPLETED")
      .sort((a, b) => {
        const da = new Date(a.actual_end_date || 0).getTime() || 0;
        const db = new Date(b.actual_end_date || 0).getTime() || 0;
        if (db !== da) return db - da;
        return (Number(b.task_id) || 0) - (Number(a.task_id) || 0);
      });
    const lastCompletedTaskIds = new Set();
    const seenEmp = new Set();
    for (const t of completedByRecency) {
      const empKey = t.emp_id ?? t.emp_name ?? null;
      if (empKey == null || seenEmp.has(empKey)) continue;
      seenEmp.add(empKey);
      lastCompletedTaskIds.add(t.task_id);
    }

    const milestones = milestoneDetails.map((milestone) => {
      const milestoneId = String(milestone.milestone_id ?? "");
      const pmsTasksForMilestone = tasksByMilestoneId.get(milestoneId) || [];

      const tasks = pmsTasksForMilestone.map((t) => {
        const taskId = t.task_id;
        const overlay = taskInfoByTaskId.get(String(taskId)) || {};

        return {
          task_id: taskId,
          // ── PMS-owned (live, never persisted by us) ──────────────────
          task_title: t.task_title || null,
          owner: t.emp_name || t.emp_id || null,
          planned_start_date: t.planned_start_date || null,
          planned_end_date: t.planned_end_date || null,
          actual_start_date: t.actual_start_date || null,
          actual_end_date: t.actual_end_date || null,
          dependency:
            t.dependency && t.dependency !== "NO" ? t.dependency : null,
          status: t.status || null,
          risk_category: t.risk_category ?? null,
          remark: t.remark ?? null,
          allocation: t.allocation ?? null,
          // ── Locally owned (editable, from task_info) ─────────────────
          emp_id: overlay.emp_id ?? null,
          role: overlay.role ?? null,
          task_type: overlay.task_type ?? null,
          unit: overlay.unit ?? null,
          // ── Derived (see completedByRecency above) ────────────────────
          is_last_completed: lastCompletedTaskIds.has(taskId),
        };
      });

      const completedTasks = tasks.filter(
        (t) => normalizeTaskStatus(t.status) === "completed",
      ).length;
      const percentage =
        tasks.length === 0
          ? 0
          : Math.round((completedTasks / tasks.length) * 100);
      const milestoneStatus =
        tasks.length === 0
          ? "Not Started"
          : percentage === 100
            ? "Completed"
            : completedTasks > 0 ||
                tasks.some(
                  (t) => normalizeTaskStatus(t.status) === "in_progress",
                )
              ? "In Progress"
              : "Not Started";

      return {
        milestone_id: milestone.milestone_id,
        milestone_name: milestone.milestone_title,
        total_tasks: tasks.length,
        completed_tasks: completedTasks,
        percentage,
        status: milestoneStatus,
        tasks,
      };
    });

    const taskInfoTab = {
      stats: computeTaskStats(milestoneDetails, tasksDetails),
      milestones,
    };

    // ── Effort Estimate tab ─────────────────────────────────────────────
    // emp_name is never stored on effort_estimate — resolved live by emp_id from HRMS (not
    // master.emp — per request, employee details here must come from HRMS only), same principle
    // as PMS-owned data. The project-wide total (overall_total_hours) is just SUM(total_hours)
    // computed here, not a separately stored/maintained value.
    const empNameMap = await getEmployeeNameMapFromHRMS();
    const effortRowsRaw = await query(
      `SELECT ee.emp_id, ee.role, ee.effort_days, ee.effort_hours,
              ee.buffer_days, ee.buffer_hours, ee.total_hours
         FROM effort_estimate ee
        WHERE ee.project_info_id = ?`,
      [projectInfoId],
    );
    const effortRows = effortRowsRaw.map((r) => ({
      ...r,
      emp_name: empNameMap.get(String(r.emp_id)) || null,
    }));

    const effort_estimates = {
      members: effortRows,
      overall_total_hours: effortRows.reduce(
        (sum, r) => sum + Number(r.total_hours || 0),
        0,
      ),
    };

    // ── Project Overview tab ────────────────────────────────────────────
    // Built mostly from data already assembled above (milestones' tasks + effortRows), plus one
    // extra call for real Logged Hours — HRMS timesheets matched by project_info.sub_category
    // (== HRMS's projectcategory_code, the same link the Timesheet Data tab uses), grouped by
    // employee via fetchCategoryTimesheetsGroupedByEmployee. Matched back to effort_estimate rows
    // by emp_id === HRMS's employee_id. If sub_category isn't set, or HRMS has no rows for it,
    // logged hours stay 0 — never guessed. Risk still has NO real source (PMS has no
    // project-level risk field, and we don't store one locally either) — left null, shown as `—`.
    let loggedHoursByEmpId = new Map();
    if (project.sub_category) {
      try {
        const hrms = await fetchCategoryTimesheetsGroupedByEmployee(
          project.sub_category,
        );
        if (hrms?.success !== false) {
          loggedHoursByEmpId = new Map(
            (hrms.data || []).map((r) => [
              String(r.employee_id),
              Number(r.total_hours) || 0,
            ]),
          );
        }
      } catch (hrmsErr) {
        console.error(
          "Error fetching HRMS logged hours for project overview:",
          hrmsErr.message,
        );
        // Falls through with an empty map — logged_hours stays 0 rather than failing the tab.
      }
    }

    const allTasks = milestones.flatMap((m) => m.tasks);

    // Per-ROLE task counts (Tasks/Done/Pending/Units), from the same PMS-status +
    // task_info-overlay join the Task Info tab already computed above.
    //
    // Joined by ROLE, not emp_id: task_info.emp_id is just PMS's own raw task assignee,
    // read-only everywhere in the app (EditTaskDrawer shows it as "Task Owner" and never lets
    // anyone change it) — it's whoever PMS's project data happens to list, not necessarily
    // anyone on our effort_estimate team. task_info.role, on the other hand, IS user-set (the
    // Edit Task drawer's Role field, from the same role_task_catalog roles Effort Estimate
    // uses), so it's the one real link between a task and an effort_estimate row. Caveat: if
    // two different people share the same role in Effort Estimate, both currently get credited
    // with that role's full task/unit stats, since task_info has no per-person task assignment
    // of its own — flagged here rather than silently double-counted without explanation.
    const taskStatsByRole = new Map();
    for (const t of allTasks) {
      if (!t.role) continue; // no role overlay set on this task yet — not counted
      if (!taskStatsByRole.has(t.role)) {
        taskStatsByRole.set(t.role, {
          tasks: 0,
          done: 0,
          pending: 0,
          units: 0,
        });
      }
      const s = taskStatsByRole.get(t.role);
      s.tasks += 1;
      s.units += Number(t.unit) || 0;
      if (normalizeTaskStatus(t.status) === "completed") s.done += 1;
      else s.pending += 1;
    }
    const EMPTY_STATS = { tasks: 0, done: 0, pending: 0, units: 0 };

    // Team Members table: one row per person (a person can hold more than one role — see the
    // multi-role Effort Estimate fix — so their alloc_hours AND task/unit stats here are summed
    // across all their effort_estimate rows/roles).
    const teamMembersMap = new Map();
    for (const row of effortRows) {
      if (!teamMembersMap.has(row.emp_id)) {
        teamMembersMap.set(row.emp_id, {
          emp_id: row.emp_id,
          emp_name: row.emp_name,
          role: null, // set below: every distinct role, comma-separated
          roles: [],
          alloc_hours: 0,
          logged_hours: loggedHoursByEmpId.get(String(row.emp_id)) || 0,
          tasks: 0,
          done: 0,
          pending: 0,
          units: 0,
        });
      }
      const m = teamMembersMap.get(row.emp_id);
      m.alloc_hours += Number(row.total_hours) || 0;
      // A role's task/unit stats are credited once per distinct role, so a person with two
      // effort rows under the same role isn't double-counted.
      if (row.role && !m.roles.includes(row.role)) {
        m.roles.push(row.role);
        const s = taskStatsByRole.get(row.role) || EMPTY_STATS;
        m.tasks += s.tasks;
        m.done += s.done;
        m.pending += s.pending;
        m.units += s.units;
      }
    }
    const team_members = [...teamMembersMap.values()].map((m) => ({
      ...m,
      role: m.roles.join(", ") || null,
    }));

    // Task Allocation & Timesheet Details table: ONE row per person (same grouping as the Team
    // Members table above). A person with several roles (e.g. BE Dev + DevOps) shows all their
    // roles in one cell, the SUM of their allocated hours across those roles, and their single
    // HRMS logged-hours total — HRMS tracks logged hours per employee, not per role, so splitting
    // into one row per role would show the same logged total against each role and look like it
    // was logged twice.
    const task_allocation = team_members.map((m) => {
      const allocHours = Math.round(m.alloc_hours * 100) / 100;
      const loggedHours = m.logged_hours;
      return {
        emp_id: m.emp_id,
        emp_name: m.emp_name,
        role: m.role,
        roles: m.roles,
        units: m.units,
        tasks: m.tasks,
        completed: m.done,
        pending: m.pending,
        alloc_hours: allocHours,
        // Task-completion progress (completed/tasks) from live PMS task status — no HRMS needed.
        progress_percent:
          m.tasks > 0 ? Math.round((m.done / m.tasks) * 100) : 0,
        logged_hours: loggedHours,
        // 0 logged hours against a real allocation IS under-utilization, not "unknown". Only
        // "nothing allocated to compare against" is null (renders `—`).
        variance_hours:
          allocHours > 0
            ? Math.round((loggedHours - allocHours) * 100) / 100
            : null,
        // Confirmed rule: Logged > Allocated by more than 1h = Over Utilized, Logged < Allocated
        // by more than 1h = Under Utilized, within ±1h = Optimally Used.
        status:
          allocHours > 0
            ? loggedHours - allocHours > 1
              ? "Over Utilized"
              : allocHours - loggedHours > 1
                ? "Under Utilized"
                : "Optimally Used"
            : null,
      };
    });

    // Project-wide completion % (the header's "Completion" stat) — completed / total tasks
    // across every milestone, same task-status data as everything else above.
    const completion_percent =
      allTasks.length === 0
        ? 0
        : Math.round(
            (allTasks.filter(
              (t) => normalizeTaskStatus(t.status) === "completed",
            ).length /
              allTasks.length) *
              100,
          );

    const overview = {
      completion_percent,
      team_members_count: team_members.length,
      total_units: allTasks.reduce((sum, t) => sum + (Number(t.unit) || 0), 0),
      total_hours_allocated: effort_estimates.overall_total_hours,
      // Sum of the SAME per-team-member logged hours shown in the Team Members table above (one
      // real HRMS total per distinct employee) — not summed from task_allocation, which would
      // double-count a multi-role person's hours once per role.
      total_hours_utilized: team_members.reduce(
        (sum, m) => sum + (Number(m.logged_hours) || 0),
        0,
      ),
      risk: null,
      team_members,
      task_allocation,
    };

    // ── Document Checklist tab ──────────────────────────────────────────
    // LEFT JOIN so every one of the 16 document_master rows shows up even
    // when nothing has been linked yet for this project ("Pending").
    // uploaded_by is stored as an emp_id (whoever was logged in when the link was added,
    // from req.user.emp_id) — never a name — and resolved live from HRMS (empNameMap, fetched
    // once above), not master.emp, same principle as effort_estimate's emp_name.
    const documents = await query(
      `SELECT dm.document_id, dm.document_name,
              dc.sharepoint_url, dc.status, dc.uploaded_by AS uploaded_by_emp_id,
              dc.uploaded_date
         FROM document_master dm
         LEFT JOIN document_checklist dc
           ON dc.document_id = dm.document_id AND dc.project_info_id = ?
        ORDER BY dm.document_id ASC`,
      [projectInfoId],
    );

    // Custom documents ("Add Document" on the frontend, not one of the 16 document_master
    // rows) have document_id NULL, so the LEFT JOIN above can never surface them — it only ever
    // walks document_master's fixed list. Fetch those separately and append them.
    const customDocuments = await query(
      `SELECT dc.custom_document_name, dc.sharepoint_url, dc.status,
              dc.uploaded_by AS uploaded_by_emp_id, dc.uploaded_date
         FROM document_checklist dc
        WHERE dc.project_info_id = ? AND dc.document_id IS NULL
        ORDER BY dc.uploaded_date ASC`,
      [projectInfoId],
    );

    const documentsWithStatus = [
      ...documents.map((doc) => ({
        document_id: doc.document_id,
        document_name: doc.document_name,
        sharepoint_url: doc.sharepoint_url || null,
        status: doc.status || "Pending",
        uploaded_by: empNameMap.get(String(doc.uploaded_by_emp_id)) || null,
        uploaded_date: doc.uploaded_date || null,
      })),
      ...customDocuments.map((doc) => ({
        document_id: null,
        document_name: doc.custom_document_name,
        sharepoint_url: doc.sharepoint_url || null,
        status: doc.status || "Uploaded",
        uploaded_by: empNameMap.get(String(doc.uploaded_by_emp_id)) || null,
        uploaded_date: doc.uploaded_date || null,
      })),
    ];

    return res.status(200).json({
      project_info: projectInfoTab,
      task_info: taskInfoTab,
      effort_estimates,
      documents: documentsWithStatus,
      overview,
    });
  } catch (err) {
    return next(err);
  }
};

// ─────────────────────────────────────────────────────────────────────────
// PUT /api/import-project/:projectInfoId
// The "Overall Edit" — updates locally-owned data across all tabs in one
// call. Never touches PMS-owned fields (those aren't accepted here at
// all); everything below is an upsert against OUR tables, same principle
// as agreed for task edits: insert-if-missing, update-if-exists, never a
// destructive rewrite of something tied to immutable PMS identifiers.
//
//   - project_info: plain UPDATE — only fields we own (project_type,
//     nbd_id, o2d_id, project_code, sub_category)
//   - task_info: upsert per task, keyed by (project_info_id, task_id) —
//     requires a UNIQUE KEY on that pair (see DB note). Only
//     role/task_type/unit/emp_id are written, same as Create Project
//   - effort_estimate: full replace (delete then re-insert what was sent)
//     — there's no natural per-row identifier to upsert against here, so
//     this tab is always resubmitted in full from the frontend
//   - document_checklist: upsert per document_id, keyed by
//     (project_info_id, document_id) — also requires a UNIQUE KEY (see DB
//     note); only rows with a sharepoint_url are written/updated
//
// Wrapped in one transaction — if anything fails, nothing changes.
// ─────────────────────────────────────────────────────────────────────────
const updateProjectInfo = async (req, res, next) => {
  const { projectInfoId } = req.params;
  const {
    project_info = {},
    tasks = [],
    effort_estimates = [],
    documents = [],
  } = req.body || {};

  const { project_type, nbd_id, o2d_id, project_code, sub_category } =
    project_info;

  const uploadedBy = req.user?.emp_id || null;

  let connection;
  try {
    connection = await quantifyPool.getConnection();
    await connection.beginTransaction();

    const [existing] = await connection.execute(
      `SELECT project_info_id FROM project_info WHERE project_info_id = ?`,
      [projectInfoId],
    );

    if (existing.length === 0) {
      await connection.rollback();
      return res.status(404).json({ message: "Imported project not found" });
    }

    // ── project_info ─────────────────────────────────────────────────────
    await connection.execute(
      `UPDATE project_info
          SET project_type = ?, nbd_id = ?, o2d_id = ?, project_code = ?, sub_category = ?
        WHERE project_info_id = ?`,
      [
        project_type || null,
        nbd_id || null,
        o2d_id || null,
        project_code || null,
        sub_category || null,
        projectInfoId,
      ],
    );

    // ── task_info (upsert) ───────────────────────────────────────────────
    for (const task of tasks) {
      const { pms_task_id, emp_id, role, task_type, unit } = task;

      if (!pms_task_id) {
        continue;
      }

      await connection.execute(
        `INSERT INTO task_info (project_info_id, task_id, emp_id, role, task_type, unit)
         VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           emp_id = VALUES(emp_id),
           role = VALUES(role),
           task_type = VALUES(task_type),
           unit = VALUES(unit)`,
        [
          projectInfoId,
          pms_task_id,
          emp_id || null,
          role || null,
          task_type || null,
          unit || null,
        ],
      );
    }

    // ── effort_estimate (full replace) ──────────────────────────────────
    await connection.execute(
      `DELETE FROM effort_estimate WHERE project_info_id = ?`,
      [projectInfoId],
    );

    for (const estimate of effort_estimates) {
      const { emp_id, role, effort_days, buffer_days } = estimate;

      if (!emp_id || !role) {
        continue;
      }

      const { effortHours, bufferHours, totalHours } = computeEffortHours(
        effort_days,
        buffer_days,
      );

      await connection.execute(
        `INSERT INTO effort_estimate
           (project_info_id, emp_id, role, effort_days, effort_hours, buffer_days, buffer_hours, total_hours)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          projectInfoId,
          emp_id,
          role,
          // Same `?? null` fix as Create Project — 0 is a legitimate effort/buffer day count,
          // not a missing value, and `||` was silently nulling it out (violating NOT NULL).
          effort_days ?? null,
          effortHours,
          buffer_days ?? null,
          bufferHours,
          totalHours,
        ],
      );
    }

    // ── document_checklist (upsert) ─────────────────────────────────────
    // Same document_id-OR-document_name rule as Create Project (see comment there). Note the
    // upsert (ON DUPLICATE KEY) only actually re-uses a row for the document_master case — a
    // custom document has document_id NULL, and MySQL treats every NULL as distinct for a
    // unique key, so re-submitting the same custom document name on a later edit currently
    // inserts a new row rather than updating the old one. Fine for now (nothing edits a custom
    // document's link yet), but worth a real dedupe key (e.g. on document_name) if that's added.
    for (const doc of documents) {
      const { document_id, document_name, sharepoint_url } = doc;

      if (!sharepoint_url || (!document_id && !document_name)) {
        continue;
      }

      await connection.execute(
        `INSERT INTO document_checklist
           (project_info_id, document_id, custom_document_name, sharepoint_url, status, uploaded_by, uploaded_date)
         VALUES (?, ?, ?, ?, 'Uploaded', ?, NOW())
         ON DUPLICATE KEY UPDATE
           sharepoint_url = VALUES(sharepoint_url),
           status = VALUES(status),
           uploaded_by = VALUES(uploaded_by),
           uploaded_date = VALUES(uploaded_date)`,
        [
          projectInfoId,
          document_id || null,
          document_id ? null : document_name || null,
          sharepoint_url,
          uploadedBy,
        ],
      );
    }

    await connection.commit();

    // Same best-effort mirror as Create Project — covers both single-task edit (tasks.length
    // === 1) and bulk edit (tasks.length > 1), since both go through this one endpoint/loop.
    const pmsSyncWarnings = await syncTasksToAhanaPilot(tasks);

    return res.status(200).json({
      message: "Project updated successfully",
      project_info_id: Number(projectInfoId),
      ...(pmsSyncWarnings.length ? { pms_sync_warnings: pmsSyncWarnings } : {}),
    });
  } catch (err) {
    if (connection) {
      await connection.rollback();
    }

    console.error("Error updating imported project:", err.message);

    if (
      err.code === "ER_NO_REFERENCED_ROW" ||
      err.code === "ER_NO_REFERENCED_ROW_2"
    ) {
      return res.status(400).json({
        message:
          "Invalid reference in payload (check document_id/task_id values)",
        error: err.message,
      });
    }

    return res.status(500).json({
      message: "Failed to update imported project",
      error: err.message,
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
};

module.exports = {
  getPmsProjectTitles,
  getPmsProjectIdByTitle,
  syncPmsProject,
  getRoles,
  getTaskCatalogByRole,
  getActiveEmployees,
  getCurrentUser,
  getProjectTypes,
  getDocumentMaster,
  createProjectInfo,
  updateProjectInfo,
  getImportedProjects,
  getProjectView,
};
