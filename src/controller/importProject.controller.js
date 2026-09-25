const { query, quantifyPool } = require("../config/db");
const { getUatToken } = require("../../helpers/pmsTokenStore");
const { pmsGet, extractProjects } = require("../../helpers/pmsHelper");

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

// Normalizes whatever PMS sends in a task's `status` field into one of our
// three buckets. PMS status strings can vary in casing/wording, so this is
// intentionally loose (contains-check) rather than an exact match.
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

    if (!projectDetails) {
      return res.status(404).json({ message: "Project not found in PMS" });
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
          message: "Authentication failed with PMS API",
          error: "Invalid or expired token",
        });
      }
      if (err.response.status === 404) {
        return res.status(404).json({ message: "Project not found in PMS" });
      }
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
         (project_id, project_type, nbd_id, o2d_id, project_code, sub_category)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        pms_project_id,
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
    for (const estimate of effort_estimates) {
      const { emp_id, role, effort_days, buffer_days } = estimate;

      if (!emp_id || !role) {
        continue; // an effort row with no member/role attached to it isn't useful
      }

      await connection.execute(
        `INSERT INTO effort_estimate
           (project_info_id, emp_id, role, effort_days, buffer_days)
         VALUES (?, ?, ?, ?, ?)`,
        [projectInfoId, emp_id, role, effort_days || null, buffer_days || null],
      );
    }

    // ── document_checklist ──────────────────────────────────────────────
    for (const doc of documents) {
      const { document_id, sharepoint_url } = doc;

      if (!document_id || !sharepoint_url) {
        continue; // no link yet -> stays "Pending" on the frontend, no row needed
      }

      await connection.execute(
        `INSERT INTO document_checklist
           (project_info_id, document_id, sharepoint_url, status, uploaded_by, uploaded_date)
         VALUES (?, ?, ?, 'Uploaded', ?, NOW())`,
        [projectInfoId, document_id, sharepoint_url, uploadedBy],
      );
    }

    await connection.commit();

    return res.status(201).json({
      message: "Project imported successfully",
      project_info_id: projectInfoId,
      pms_project_id,
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
      `SELECT project_info_id, project_id, project_type, nbd_id, o2d_id,
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
        // ── PMS-owned (live, never persisted by us) ──────────────────
        project_title: pmsProject?.project_title || pmsProject?.title || null,
        customer_name: pmsProject?.customer_name || null,
        status: pmsProject?.status || null,
        planned_start_date: pmsProject?.planned_start_date || null,
        planned_end_date: pmsProject?.planned_end_date || null,
        description: pmsProject?.description || null,
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
      `SELECT project_info_id, project_id, project_type, nbd_id, o2d_id,
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
      project_name:
        projectDetails?.project_title || projectDetails?.title || null,
      customer_name: projectDetails?.customer_name || null,
      presale_id:
        projectDetails?.presales_id || projectDetails?.presale_id || null,
      start_date: projectDetails?.planned_start_date || null,
      end_date: projectDetails?.planned_end_date || null,
      project_status: projectDetails?.status || null,
      description: projectDetails?.description || null,
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
    // risk_category/remark/allocation are also PMS-owned and live — not in
    // the sample payload we've seen, so the keys below (`risk_category`,
    // `remark`, `allocation`) are a best guess pending confirmation of the
    // exact field names PMS actually uses for these three.
    const tasksByMilestoneId = new Map();
    for (const task of tasksDetails) {
      const milestoneId = String(task.project_milestone_id ?? "");
      if (!tasksByMilestoneId.has(milestoneId)) {
        tasksByMilestoneId.set(milestoneId, []);
      }
      tasksByMilestoneId.get(milestoneId).push(task);
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
          role: overlay.role ?? null,
          task_type: overlay.task_type ?? null,
          unit: overlay.unit ?? null,
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
    const effort_estimates = await query(
      `SELECT emp_id, role, effort_days, buffer_days
         FROM effort_estimate
        WHERE project_info_id = ?`,
      [projectInfoId],
    );

    // ── Document Checklist tab ──────────────────────────────────────────
    // LEFT JOIN so every one of the 16 document_master rows shows up even
    // when nothing has been linked yet for this project ("Pending").
    const documents = await query(
      `SELECT dm.document_id, dm.document_name,
              dc.sharepoint_url, dc.status, dc.uploaded_by, dc.uploaded_date
         FROM document_master dm
         LEFT JOIN document_checklist dc
           ON dc.document_id = dm.document_id AND dc.project_info_id = ?
        ORDER BY dm.document_id ASC`,
      [projectInfoId],
    );

    const documentsWithStatus = documents.map((doc) => ({
      document_id: doc.document_id,
      document_name: doc.document_name,
      sharepoint_url: doc.sharepoint_url || null,
      status: doc.status || "Pending",
      uploaded_by: doc.uploaded_by || null,
      uploaded_date: doc.uploaded_date || null,
    }));

    return res.status(200).json({
      project_info: projectInfoTab,
      task_info: taskInfoTab,
      effort_estimates,
      documents: documentsWithStatus,
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

      await connection.execute(
        `INSERT INTO effort_estimate (project_info_id, emp_id, role, effort_days, buffer_days)
         VALUES (?, ?, ?, ?, ?)`,
        [projectInfoId, emp_id, role, effort_days || null, buffer_days || null],
      );
    }

    // ── document_checklist (upsert) ─────────────────────────────────────
    for (const doc of documents) {
      const { document_id, sharepoint_url } = doc;

      if (!document_id || !sharepoint_url) {
        continue;
      }

      await connection.execute(
        `INSERT INTO document_checklist
           (project_info_id, document_id, sharepoint_url, status, uploaded_by, uploaded_date)
         VALUES (?, ?, ?, 'Uploaded', ?, NOW())
         ON DUPLICATE KEY UPDATE
           sharepoint_url = VALUES(sharepoint_url),
           status = VALUES(status),
           uploaded_by = VALUES(uploaded_by),
           uploaded_date = VALUES(uploaded_date)`,
        [projectInfoId, document_id, sharepoint_url, uploadedBy],
      );
    }

    await connection.commit();

    return res.status(200).json({
      message: "Project updated successfully",
      project_info_id: Number(projectInfoId),
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
  syncPmsProject,
  getRoles,
  getDocumentMaster,
  createProjectInfo,
  updateProjectInfo,
  getImportedProjects,
  getProjectView,
};
