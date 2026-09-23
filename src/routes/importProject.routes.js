const express = require("express");
const router = express.Router();

const { authMiddleware } = require("../middleware/auth.middleware");
const {
  syncPmsProject,
  getRoles,
  getDocumentMaster,
  createProjectInfo,
  updateProjectInfo,
  getImportedProjects,
  getProjectView,
} = require("../controller/importProject.controller");

// ── Projects Table ───────────────────────────────────────────────────────
// GET /api/import-project — list all imported projects, PMS fields merged
// live at read-time, for the main Projects table/listing screen.
router.get("/", authMiddleware, getImportedProjects);

// ── Step 1: Project Info ────────────────────────────────────────────────
// GET /api/import-project/pms-sync?projectId=X — fetch + pre-fill from PMS
router.get("/pms-sync", authMiddleware, syncPmsProject);

// ── Step 3: Effort Estimate ─────────────────────────────────────────────
// GET /api/import-project/roles — distinct role headers (BA, UI, TL, FE
// Dev, BE Dev, Tester) from role_task_catalog, for the Effort Estimate
// screen's grouping + "+ Add Member" role dropdown.
router.get("/roles", authMiddleware, getRoles);

// ── Step 4: Document Checklist ──────────────────────────────────────────
// GET /api/import-project/documents — the fixed 16-row document_master
// list, rendered as "Pending" checklist entries until the user adds a
// SharePoint link for each.
router.get("/documents", authMiddleware, getDocumentMaster);

// ── Create Project (final step) ─────────────────────────────────────────
// POST /api/import-project — persists Steps 1-4 in one call
router.post("/", authMiddleware, createProjectInfo);

// ── View Project (Action → View icon) ───────────────────────────────────
// GET /api/import-project/:projectInfoId — Task Info, Effort Estimate and
// Document Checklist tabs (Project Overview and Timesheet left out for
// now). Declared after the other literal GET routes above so it doesn't
// shadow /pms-sync, /roles, /documents.
router.get("/:projectInfoId", authMiddleware, getProjectView);

// ── Overall Edit (Action → Edit icon) ───────────────────────────────────
// PUT /api/import-project/:projectInfoId — updates locally-owned data
// across all tabs (project_info, task_info, effort_estimate,
// document_checklist) in one call. PMS-owned fields are never accepted
// here — they always come live from PMS.
router.put("/:projectInfoId", authMiddleware, updateProjectInfo);

module.exports = router;

/**
 * @swagger
 * tags:
 *   - name: Import Project
 *     description: Import Project wizard APIs - Step 1 PMS sync for the Project Info form
 */

/**
 * @swagger
 * /import-project:
 *   get:
 *     summary: List Imported Projects (Projects Table)
 *     description: |
 *       Returns every project that has gone through the Import Project
 *       wizard, for the main Projects table/listing screen.
 *
 *       ### Key Features:
 *       - Our DB (`project_info`) decides which PMS projects are "imported"
 *         and supplies every locally-owned field (project_type, nbd_id,
 *         o2d_id, project_code, sub_category)
 *       - PMS-owned fields (project title, customer, status, planned
 *         start/end dates, description) are never stored by us — they're
 *         fetched live from PMS `getAllProjects` on every call and merged
 *         in by `project_id`, so this always reflects PMS's current data.
 *         NOTE: description may come back null here if `getAllProjects`
 *         doesn't include it (unconfirmed) — View's pms-sync call does
 *       - Only one PMS call is made total (`getAllProjects`), not one per
 *         project, then matched in memory — same pattern used for the
 *         existing PMS dropdown fetch, just merged with our own rows here
 *       - If the PMS call fails, the list still returns with local fields
 *         populated and PMS fields left null, rather than failing outright
 *
 *       ### Authentication:
 *       Same as `/import-project/pms-sync` — needs the UAT token cached at
 *       login (looked up by `emp_id`), not this app's own JWT.
 *
 *     tags: [Import Project]
 *     security:
 *       - bearerAuth: []
 *
 *     responses:
 *       200:
 *         description: Imported projects retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 projects:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       project_info_id:
 *                         type: integer
 *                         example: 7
 *                       project_id:
 *                         type: string
 *                         description: PMS project ID
 *                         example: "2"
 *                       project_title:
 *                         type: string
 *                         nullable: true
 *                         example: "Ahana Revamp"
 *                       customer_name:
 *                         type: string
 *                         nullable: true
 *                         example: "Acme Corp"
 *                       status:
 *                         type: string
 *                         nullable: true
 *                         example: "In Progress"
 *                       planned_start_date:
 *                         type: string
 *                         nullable: true
 *                         example: "2026-01-15"
 *                       planned_end_date:
 *                         type: string
 *                         nullable: true
 *                         example: "2026-06-30"
 *                       description:
 *                         type: string
 *                         nullable: true
 *                         description: PMS-owned, non-editable — may be null if getAllProjects doesn't include it
 *                         example: "Revamp of the internal project management tool"
 *                       project_type:
 *                         type: string
 *                         nullable: true
 *                         example: "Fixed Bid"
 *                       nbd_id:
 *                         type: string
 *                         nullable: true
 *                         example: "NBD-1023"
 *                       o2d_id:
 *                         type: string
 *                         nullable: true
 *                         example: "O2D-4521"
 *                       project_code:
 *                         type: string
 *                         nullable: true
 *                         example: "AH-2026-002"
 *                       sub_category:
 *                         type: string
 *                         nullable: true
 *                         example: "Web Application"
 *                       created_at:
 *                         type: string
 *                         example: "2026-09-19T10:15:00.000Z"
 *             example:
 *               projects:
 *                 - project_info_id: 7
 *                   project_id: "2"
 *                   project_title: "Ahana Revamp"
 *                   customer_name: "Acme Corp"
 *                   status: "In Progress"
 *                   planned_start_date: "2026-01-15"
 *                   planned_end_date: "2026-06-30"
 *                   project_type: "Fixed Bid"
 *                   nbd_id: "NBD-1023"
 *                   o2d_id: "O2D-4521"
 *                   project_code: "AH-2026-002"
 *                   sub_category: "Web Application"
 *                   description: "Revamp of the internal project management tool"
 *                   created_at: "2026-09-19T10:15:00.000Z"
 *
 *       401:
 *         description: Unauthorized - our own token invalid, or no cached PMS/UAT session
 *         content:
 *           application/json:
 *             examples:
 *               noOwnToken:
 *                 value:
 *                   message: "Invalid or expired token."
 *               noPmsSession:
 *                 value:
 *                   message: "PMS session not found or expired. Please log in again to refresh your PMS access."
 *
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */

/**
 * @swagger
 * /import-project/pms-sync:
 *   get:
 *     summary: Sync Project Details from PMS (Step 1)
 *     description: |
 *       Fetches a project's details from the PMS system by its PMS project
 *       ID, for pre-filling Step 1 (Project Info) of the Import Project
 *       wizard. Nothing is persisted by this call — it's read-only.
 *
 *       ### Key Features:
 *       - Calls PMS `getProjectDetails?projectId=X`
 *       - Returns `projectDetails` as-is (no field renaming/remapping)
 *       - Also returns `milestoneDetails`/`tasksDetails` from the same PMS
 *         call so the frontend has Step 2's data ready without a second
 *         PMS round-trip
 *       - Plain pass-through to PMS — no database involved
 *
 *       ### Use Cases:
 *       - Pre-fill Step 1 (Project Info) when a PMS project ID is entered
 *       - Supply Step 2 (Task Info) milestones/tasks in the same round-trip
 *
 *       ### Authentication:
 *       PMS only accepts the original UAT-issued token, not this app's own
 *       JWT. That UAT token is cached server-side at login (keyed by
 *       emp_id) and looked up here automatically — the caller only needs
 *       to send this app's normal Bearer token as usual. If the cached UAT
 *       token is missing or has expired, this returns 401 asking the user
 *       to log in again.
 *
 *     tags: [Import Project]
 *     security:
 *       - bearerAuth: []
 *
 *     parameters:
 *       - in: query
 *         name: projectId
 *         required: true
 *         schema:
 *           type: string
 *         description: PMS project ID to sync
 *         example: "2"
 *
 *     responses:
 *       200:
 *         description: Project details fetched from PMS successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 projectDetails:
 *                   type: object
 *                   description: Raw PMS project record (project_title, customer_name, o2d_id, presales_id, planned_start_date, planned_end_date, description, status, project_code, etc.)
 *                 milestoneDetails:
 *                   type: array
 *                   description: Milestones for this PMS project, for Step 2
 *                   items:
 *                     type: object
 *                 tasksDetails:
 *                   type: array
 *                   description: Tasks for this PMS project, for Step 2
 *                   items:
 *                     type: object
 *
 *       400:
 *         description: Bad Request - projectId missing
 *         content:
 *           application/json:
 *             example:
 *               message: "projectId (PMS project ID) is required"
 *
 *       401:
 *         description: Unauthorized - our own token invalid, or no cached PMS/UAT session
 *         content:
 *           application/json:
 *             examples:
 *               noOwnToken:
 *                 value:
 *                   message: "Invalid or expired token."
 *               noPmsSession:
 *                 value:
 *                   message: "PMS session not found or expired. Please log in again to refresh your PMS access."
 *
 *       404:
 *         description: Project not found in PMS
 *         content:
 *           application/json:
 *             example:
 *               message: "Project not found in PMS"
 *
 *       500:
 *         description: Failed to fetch project details from PMS
 *         content:
 *           application/json:
 *             example:
 *               message: "Failed to fetch project details from PMS"
 *               error: "connect ETIMEDOUT"
 */

/**
 * @swagger
 * /import-project/roles:
 *   get:
 *     summary: Get Distinct Roles for Effort Estimate
 *     description: |
 *       Retrieves the distinct list of roles from the `role_task_catalog`
 *       reference table.
 *
 *       ### Key Features:
 *       - Returns each role exactly once (DISTINCT), alphabetically sorted
 *       - Backed entirely by our own DB — no PMS/external call involved
 *       - Powers Step 3 (Effort Estimate) of the Import Project wizard:
 *         the role group headers (BA, UI, TL, FE Dev, BE Dev, Tester) and
 *         the "+ Add Member" role dropdown
 *
 *       ### Use Cases:
 *       - Populate Effort Estimate role headers
 *       - Populate the "+ Add Member" role dropdown
 *       - Any other screen needing the canonical role list
 *
 *     tags: [Import Project]
 *     security:
 *       - bearerAuth: []
 *
 *     responses:
 *       200:
 *         description: Distinct roles retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 roles:
 *                   type: array
 *                   description: Distinct role names, alphabetically sorted
 *                   items:
 *                     type: string
 *                   example: ["BA", "BE Dev", "FE Dev", "TL", "Tester", "UI"]
 *             example:
 *               roles: ["BA", "BE Dev", "FE Dev", "TL", "Tester", "UI"]
 *
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */

/**
 * @swagger
 * /import-project/documents:
 *   get:
 *     summary: Get Document Master List for Document Checklist
 *     description: |
 *       Retrieves the fixed, master list of document types from
 *       `document_master` — the reference table listing every document a
 *       project's checklist tracks (BRD or CR, Proposal Document, Effort
 *       Estimate, Solution architecture, DB design document, Swagger API
 *       document, UI/UX, Test plan, Testcase document, QA signoff, UAT
 *       signoff, Technical Design Document, Release Notes, Risk registry,
 *       User manual, GIT Repository Link).
 *
 *       ### Key Features:
 *       - Returns all 16 document types, ordered by `document_id`
 *       - Backed entirely by our own DB — no PMS/external call involved
 *       - Powers Step 4 (Document Checklist): each row renders as a
 *         "Pending" entry until the user adds a SharePoint link for it
 *
 *       ### Use Cases:
 *       - Populate the Document Checklist table on project import
 *       - Populate the same checklist on the View/Edit project screens
 *
 *     tags: [Import Project]
 *     security:
 *       - bearerAuth: []
 *
 *     responses:
 *       200:
 *         description: Document master list retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 documents:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       document_id:
 *                         type: integer
 *                         example: 1
 *                       document_name:
 *                         type: string
 *                         example: "BRD or CR"
 *             example:
 *               documents:
 *                 - document_id: 1
 *                   document_name: "BRD or CR"
 *                 - document_id: 2
 *                   document_name: "Proposal Document"
 *                 - document_id: 3
 *                   document_name: "Effort Estimate"
 *
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */

/**
 * @swagger
 * /import-project:
 *   post:
 *     summary: Create Imported Project (final step)
 *     description: |
 *       Persists everything gathered across all 4 steps of the Import
 *       Project wizard in one call. Only locally-owned fields are written —
 *       PMS-owned data (project name, customer, status, dates, description,
 *       task titles/dates/dependencies, etc.) is never stored here and is
 *       always re-fetched live from PMS at read-time via
 *       `/import-project/pms-sync`. Note: `project_info.description` is NOT
 *       part of this payload — it's a PMS field, non-editable here.
 *
 *       ### Key Features:
 *       - Single DB transaction across `project_info`, `task_info`,
 *         `effort_estimate`, `document_checklist` — if anything fails,
 *         nothing is persisted
 *       - `tasks[]` rows are optional per-field: `emp_id`/`role`/`task_type`/
 *         `unit` may all be omitted on creation (they belong to Edit Task
 *         Details) — only `pms_task_id` is required per task row
 *       - `risk_category`, `remark` and `allocation` are all PMS-owned and
 *         live — they are NOT part of this payload and are never persisted
 *         by us; they always come from PMS at read-time (pms-sync/View)
 *       - The "Bulk Update" action on the Task Info screen (role/task_type/
 *         unit applied to several selected tasks at once) is a frontend
 *         convenience only — it just sets the same values across multiple
 *         entries in `tasks[]` before submitting; no separate API for it
 *       - `documents[]` only needs entries the user actually linked; any
 *         document type left unlinked simply has no row and renders as
 *         "Pending" on the frontend
 *       - `tasks[]` and `effort_estimates[]` may both be empty arrays
 *
 *       ### Use Cases:
 *       - Final "Create Project" action on the Import Project wizard
 *
 *     tags: [Import Project]
 *     security:
 *       - bearerAuth: []
 *
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - pms_project_id
 *             properties:
 *               pms_project_id:
 *                 type: string
 *                 example: "2"
 *               project_info:
 *                 type: object
 *                 properties:
 *                   project_type:
 *                     type: string
 *                     example: "Fixed Bid"
 *                   nbd_id:
 *                     type: string
 *                     example: "NBD-1023"
 *                   o2d_id:
 *                     type: string
 *                     example: "O2D-4521"
 *                   project_code:
 *                     type: string
 *                     example: "AH-2026-002"
 *                   sub_category:
 *                     type: string
 *                     example: "Web Application"
 *               tasks:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required:
 *                     - pms_task_id
 *                   properties:
 *                     pms_task_id:
 *                       type: string
 *                       example: "1024"
 *                     emp_id:
 *                       type: string
 *                       nullable: true
 *                       example: "AS00472"
 *                     role:
 *                       type: string
 *                       nullable: true
 *                       example: "BA"
 *                     task_type:
 *                       type: string
 *                       nullable: true
 *                       example: "Analysis"
 *                     unit:
 *                       type: number
 *                       nullable: true
 *                       example: 98
 *               effort_estimates:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required:
 *                     - emp_id
 *                     - role
 *                   properties:
 *                     emp_id:
 *                       type: string
 *                       example: "AS00717"
 *                     role:
 *                       type: string
 *                       example: "BA"
 *                     effort_days:
 *                       type: number
 *                       example: 10
 *                     buffer_days:
 *                       type: number
 *                       example: 2
 *               documents:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required:
 *                     - document_id
 *                     - sharepoint_url
 *                   properties:
 *                     document_id:
 *                       type: integer
 *                       example: 1
 *                     sharepoint_url:
 *                       type: string
 *                       example: "https://ahana-ai.sharepoint.com/sites/Project2/BRD.docx"
 *           example:
 *             pms_project_id: "2"
 *             project_info:
 *               project_type: "Fixed Bid"
 *               nbd_id: "NBD-1023"
 *               o2d_id: "O2D-4521"
 *               project_code: "AH-2026-002"
 *               sub_category: "Web Application"
 *             tasks:
 *               - pms_task_id: "1024"
 *                 emp_id: "AS00472"
 *                 role: "BA"
 *                 task_type: "Analysis"
 *                 unit: 98
 *             effort_estimates:
 *               - emp_id: "AS00717"
 *                 role: "BA"
 *                 effort_days: 10
 *                 buffer_days: 2
 *             documents:
 *               - document_id: 1
 *                 sharepoint_url: "https://ahana-ai.sharepoint.com/sites/Project2/BRD.docx"
 *
 *     responses:
 *       201:
 *         description: Project imported successfully
 *         content:
 *           application/json:
 *             example:
 *               message: "Project imported successfully"
 *               project_info_id: 7
 *               pms_project_id: "2"
 *
 *       400:
 *         description: Bad Request - pms_project_id missing, or an invalid reference in payload
 *         content:
 *           application/json:
 *             examples:
 *               missingProjectId:
 *                 value:
 *                   message: "pms_project_id is required"
 *               invalidReference:
 *                 value:
 *                   message: "Invalid reference in payload (check document_id/task_id values)"
 *
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *
 *       409:
 *         description: This PMS project has already been imported
 *         content:
 *           application/json:
 *             example:
 *               message: "This project has already been imported"
 *
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */

/**
 * @swagger
 * /import-project/{projectInfoId}:
 *   get:
 *     summary: View Imported Project (Action → View)
 *     description: |
 *       Returns one imported project's details for the View screen's tabs,
 *       still keyed by our own project_info_id. Project Overview (as a
 *       fifth tab) is now the `project_info` block below; Timesheet Data
 *       is still left out for now.
 *
 *       ### Key Features:
 *       - `project_info`: PMS's live projectDetails (project name,
 *         customer, presale ID, start/end date, project status,
 *         description — all PMS-owned, non-editable) merged with our own
 *         project_info row (project type, NBD ID, O2D ID, project code,
 *         sub category — locally owned)
 *       - `task_info.stats`: overall milestone/task completion counts and
 *         percentages, computed the same way as pms-sync's `stats` block
 *       - `task_info.milestones[]`: each milestone (from PMS) with its own
 *         completion percentage/status, and its `tasks[]` — PMS's live
 *         task fields (title, owner, dates, dependency, status,
 *         risk_category, remark, allocation) merged with our own
 *         task_info row (role, task_type, unit — the only three fields we
 *         actually store and let the user edit)
 *       - `effort_estimates[]`: plain read of this project's
 *         `effort_estimate` rows
 *       - `documents[]`: all 16 `document_master` rows, LEFT JOINed with
 *         this project's `document_checklist` rows — an unlinked document
 *         still shows up with `status: "Pending"` instead of being missing
 *       - If the PMS call fails, PMS-owned fields render null/empty rather
 *         than failing the whole view
 *
 *       ### Authentication:
 *       Same as `/import-project/pms-sync` — needs the UAT token cached at
 *       login (looked up by `emp_id`), not this app's own JWT.
 *
 *     tags: [Import Project]
 *     security:
 *       - bearerAuth: []
 *
 *     parameters:
 *       - in: path
 *         name: projectInfoId
 *         required: true
 *         schema:
 *           type: integer
 *         description: Our own project_info primary key (not the PMS project ID)
 *         example: 7
 *
 *     responses:
 *       200:
 *         description: Imported project details retrieved successfully
 *         content:
 *           application/json:
 *             example:
 *               project_info:
 *                 project_info_id: 7
 *                 pms_id: "2"
 *                 project_name: "Aseuro - Intune Bug Fix"
 *                 customer_name: null
 *                 presale_id: null
 *                 start_date: "2023-03-19T18:30:00.000Z"
 *                 end_date: "2023-03-23T18:30:00.000Z"
 *                 project_status: "INACTIVE"
 *                 description: "Intune Issue analysis and Bug Fix"
 *                 project_type: "Fixed Bid"
 *                 nbd_id: "NBD-1023"
 *                 o2d_id: "O2D-4521"
 *                 project_code: "AH-2026-002"
 *                 sub_category: "Web Application"
 *                 created_at: "2026-09-19T10:15:00.000Z"
 *               task_info:
 *                 stats:
 *                   milestones:
 *                     total: 8
 *                     completed: 3
 *                     percentage: 38
 *                   tasks:
 *                     total: 145
 *                     completed: 69
 *                     in_progress: 19
 *                     not_started: 57
 *                 milestones:
 *                   - milestone_id: 6
 *                     milestone_name: "Planning & Initiation"
 *                     total_tasks: 12
 *                     completed_tasks: 12
 *                     percentage: 100
 *                     status: "Completed"
 *                     tasks:
 *                       - task_id: 1024
 *                         task_title: "Requirements Gathering"
 *                         owner: "Sarah J."
 *                         planned_start_date: "2024-10-01T00:00:00.000Z"
 *                         planned_end_date: "2024-10-15T00:00:00.000Z"
 *                         actual_start_date: "2024-10-01T00:00:00.000Z"
 *                         actual_end_date: "2024-10-14T00:00:00.000Z"
 *                         dependency: null
 *                         status: "COMPLETED"
 *                         risk_category: null
 *                         remark: null
 *                         allocation: null
 *                         role: "BA"
 *                         task_type: "Analysis"
 *                         unit: 98
 *               effort_estimates:
 *                 - emp_id: "AS00717"
 *                   role: "BA"
 *                   effort_days: 10
 *                   buffer_days: 2
 *               documents:
 *                 - document_id: 1
 *                   document_name: "BRD or CR"
 *                   sharepoint_url: "https://ahana-ai.sharepoint.com/sites/Project2/BRD.docx"
 *                   status: "Uploaded"
 *                   uploaded_by: "AS00472"
 *                   uploaded_date: "2026-09-19T10:15:00.000Z"
 *                 - document_id: 2
 *                   document_name: "Proposal Document"
 *                   sharepoint_url: null
 *                   status: "Pending"
 *                   uploaded_by: null
 *                   uploaded_date: null
 *
 *       404:
 *         description: Imported project not found
 *         content:
 *           application/json:
 *             example:
 *               message: "Imported project not found"
 *
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */

/**
 * @swagger
 * /import-project/{projectInfoId}:
 *   put:
 *     summary: Edit Imported Project (Action → Edit)
 *     description: |
 *       Updates locally-owned data for an already-imported project across
 *       all tabs in a single call. Only fields we actually own are ever
 *       accepted or written — PMS-owned data (project name, customer,
 *       status, dates, description, task titles/dates/dependency,
 *       risk_category, remark, allocation, etc.) is not part of this
 *       payload at all and is never touched here; it is always re-fetched
 *       live from PMS at read-time via `/import-project/pms-sync` or the
 *       View endpoint.
 *
 *       ### Key Features:
 *       - Single DB transaction across `project_info`, `task_info`,
 *         `effort_estimate`, `document_checklist` — if anything fails,
 *         nothing is changed
 *       - `project_info`: plain UPDATE of only the locally-owned fields
 *         (project_type, nbd_id, o2d_id, project_code, sub_category)
 *       - `tasks[]`: upsert per task, keyed by (project_info_id,
 *         pms_task_id) — insert-if-missing, update-if-exists. Only
 *         `emp_id`/`role`/`task_type`/`unit` are written, same as Create
 *         Project. Requires a UNIQUE KEY on `task_info
 *         (project_info_id, task_id)`
 *       - `effort_estimates[]`: full replace — all of this project's
 *         existing `effort_estimate` rows are deleted and replaced with
 *         whatever is submitted, since there's no natural per-row
 *         identifier to upsert against. The frontend should always
 *         resubmit the full list for this tab, not just changed rows
 *       - `documents[]`: upsert per `document_id`, keyed by
 *         (project_info_id, document_id) — insert-if-missing,
 *         update-if-exists. Only rows with a `sharepoint_url` are
 *         written/updated; requires a UNIQUE KEY on `document_checklist
 *         (project_info_id, document_id)`
 *       - 404 if `projectInfoId` doesn't exist in our DB
 *
 *       ### Authentication:
 *       This app's own Bearer token (not the PMS UAT token — no PMS call
 *       is made by this endpoint).
 *
 *     tags: [Import Project]
 *     security:
 *       - bearerAuth: []
 *
 *     parameters:
 *       - in: path
 *         name: projectInfoId
 *         required: true
 *         schema:
 *           type: integer
 *         description: Our own project_info primary key (not the PMS project ID)
 *         example: 7
 *
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               project_info:
 *                 type: object
 *                 properties:
 *                   project_type:
 *                     type: string
 *                     example: "Fixed Bid"
 *                   nbd_id:
 *                     type: string
 *                     example: "NBD-1023"
 *                   o2d_id:
 *                     type: string
 *                     example: "O2D-4521"
 *                   project_code:
 *                     type: string
 *                     example: "AH-2026-002"
 *                   sub_category:
 *                     type: string
 *                     example: "Web Application"
 *               tasks:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required:
 *                     - pms_task_id
 *                   properties:
 *                     pms_task_id:
 *                       type: string
 *                       example: "1024"
 *                     emp_id:
 *                       type: string
 *                       nullable: true
 *                       example: "AS00472"
 *                     role:
 *                       type: string
 *                       nullable: true
 *                       example: "BA"
 *                     task_type:
 *                       type: string
 *                       nullable: true
 *                       example: "Analysis"
 *                     unit:
 *                       type: number
 *                       nullable: true
 *                       example: 98
 *               effort_estimates:
 *                 type: array
 *                 description: Full replacement list — resubmit every row for this project, not just changed ones
 *                 items:
 *                   type: object
 *                   required:
 *                     - emp_id
 *                     - role
 *                   properties:
 *                     emp_id:
 *                       type: string
 *                       example: "AS00717"
 *                     role:
 *                       type: string
 *                       example: "BA"
 *                     effort_days:
 *                       type: number
 *                       example: 10
 *                     buffer_days:
 *                       type: number
 *                       example: 2
 *               documents:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required:
 *                     - document_id
 *                     - sharepoint_url
 *                   properties:
 *                     document_id:
 *                       type: integer
 *                       example: 1
 *                     sharepoint_url:
 *                       type: string
 *                       example: "https://ahana-ai.sharepoint.com/sites/Project2/BRD.docx"
 *           example:
 *             project_info:
 *               project_type: "Fixed Bid"
 *               nbd_id: "NBD-1023"
 *               o2d_id: "O2D-4521"
 *               project_code: "AH-2026-002"
 *               sub_category: "Web Application"
 *             tasks:
 *               - pms_task_id: "1024"
 *                 emp_id: "AS00472"
 *                 role: "BA"
 *                 task_type: "Analysis"
 *                 unit: 98
 *             effort_estimates:
 *               - emp_id: "AS00717"
 *                 role: "BA"
 *                 effort_days: 10
 *                 buffer_days: 2
 *             documents:
 *               - document_id: 1
 *                 sharepoint_url: "https://ahana-ai.sharepoint.com/sites/Project2/BRD.docx"
 *
 *     responses:
 *       200:
 *         description: Project updated successfully
 *         content:
 *           application/json:
 *             example:
 *               message: "Project updated successfully"
 *               project_info_id: 7
 *
 *       400:
 *         description: Bad Request - invalid reference in payload
 *         content:
 *           application/json:
 *             example:
 *               message: "Invalid reference in payload (check document_id/task_id values)"
 *
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *
 *       404:
 *         description: Imported project not found
 *         content:
 *           application/json:
 *             example:
 *               message: "Imported project not found"
 *
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
