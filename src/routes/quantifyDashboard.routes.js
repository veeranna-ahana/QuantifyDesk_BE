const express = require("express");
const router = express.Router();

const { authMiddleware } = require("../middleware/auth.middleware");
const {
  getDashboardOverview,
  getEmployeeUtilization,
  getAllEmployeesUtilization,
} = require("../controller/quantifyDashboard.controller");

// ── Dashboard ────────────────────────────────────────────────────────────
// GET /api/import-project/dashboard/overview — Cards, Project Health
// Overview, Project Status Distribution and Project Delivery Performance
// table, in one call, scoped to imported projects only.
router.get("/overview", authMiddleware, getDashboardOverview);
router.get('/employee/:emp_id', getEmployeeUtilization);
router.get('/all-employees', getAllEmployeesUtilization);


module.exports = router;

/**
 * @swagger
 * tags:
 *   - name: Import Project Dashboard
 *     description: Dashboard screen for imported projects (Cards, Health Overview, Status Distribution, Delivery Performance)
 */

/**
 * @swagger
 * /import-project/dashboard/overview:
 *   get:
 *     summary: Dashboard Overview (Cards, Health, Status Distribution, Delivery Performance)
 *     description: |
 *       Single combined API for the main Dashboard screen. Scoped ONLY to
 *       projects that have gone through the Import Project wizard (our own
 *       `project_info` rows) — not every PMS project.
 *
 *       ### Key Features:
 *       - `cards`: All Projects (our row count) / In Progress / Completed /
 *         Delayed, bucketed from ONE PMS `getAllProjects` call matched to
 *         our rows by project_id — same pattern as `/import-project`
 *       - `health_overview`: On Track / In Progress / At Risk / Delayed /
 *         Completed counts + percentages. "Delayed" = planned_end_date has
 *         passed and the project isn't Completed (confirmed rule). "At
 *         Risk" is not implemented yet — its threshold hasn't been decided,
 *         so it will always be 0 for now; those projects currently fall
 *         under "On Track"
 *       - `status_distribution`: Active / Completed / On Hold / Delayed
 *         counts + percentages, same underlying classification as above
 *       - `delivery_performance`: one row per imported project — title
 *         (PMS live), code (ours), units (sum of our task_info.unit),
 *         completion % (from that project's PMS tasks, one
 *         getProjectDetails call per project since PMS has no bulk
 *         milestones/tasks endpoint), risk (always null for now — PMS
 *         hasn't shipped task-level risk_category yet), and status (same
 *         label as health_overview's bucket for that project)
 *       - Degrades gracefully: if the PMS getAllProjects call fails,
 *         every project shows unknown status rather than failing the whole
 *         dashboard; if a single project's getProjectDetails call fails,
 *         only that row's completion % falls back to 0
 *
 *       ### Authentication:
 *       Same as `/import-project/pms-sync` — needs the UAT token cached at
 *       login (looked up by `emp_id`), not this app's own JWT.
 *
 *     tags: [Import Project Dashboard]
 *     security:
 *       - bearerAuth: []
 *
 *     responses:
 *       200:
 *         description: Dashboard data retrieved successfully
 *         content:
 *           application/json:
 *             example:
 *               cards:
 *                 all_projects: 42
 *                 in_progress: 28
 *                 completed: 10
 *                 delayed: 3
 *               health_overview:
 *                 total_projects: 42
 *                 buckets:
 *                   - status: "On Track"
 *                     count: 24
 *                     percentage: 57
 *                   - status: "In Progress"
 *                     count: 8
 *                     percentage: 19
 *                   - status: "At Risk"
 *                     count: 0
 *                     percentage: 0
 *                   - status: "Delayed"
 *                     count: 3
 *                     percentage: 7
 *                   - status: "Completed"
 *                     count: 2
 *                     percentage: 5
 *               status_distribution:
 *                 total_projects: 42
 *                 buckets:
 *                   - status: "Active"
 *                     count: 30
 *                     percentage: 71
 *                   - status: "Completed"
 *                     count: 10
 *                     percentage: 24
 *                   - status: "On Hold"
 *                     count: 0
 *                     percentage: 0
 *                   - status: "Delayed"
 *                     count: 2
 *                     percentage: 5
 *               delivery_performance:
 *                 - project_info_id: 7
 *                   project_id: "2"
 *                   project_title: "Core Banking Upgrade"
 *                   project_code: "KBL-042"
 *                   units: 8
 *                   completion_percentage: 82
 *                   risk: null
 *                   status: "On Track"
 *
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */

/**
 * @swagger
 * /import-project/dashboard/employee/{emp_id}:
 *   get:
 *     summary: Get employee utilization
 *     description: |
 *       Returns an employee's assigned projects, effort totals, HRMS logged
 *       hours, and PMS task details. The PMS bearer token should pass in
 *       the Authorization header; If the employee has no assigned projects,
 *       the endpoint returns an empty project list without calling PMS.
 *     tags: [Employee Utilization]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: emp_id
 *         required: true
 *         description: Employee identifier.
 *         schema:
 *           type: string
 *         example: AS01989
 *
 *     responses:
 *       200:
 *         description: Employee utilization retrieved successfully.
 *         content:
 *           application/json:
 *             examples:
 *               withProjects:
 *                 summary: Employee with assigned projects
 *                 value:
 *                   success: true
 *                   emp_id: AS01989
 *                   total_projects: 1
 *                   totals:
 *                     total_assigned_days: 12.5
 *                     total_assigned_hours: 100
 *                     total_logged_hours: 36
 *                   projects:
 *                     - project_info_id: 7
 *                       pms_project_id: "2"
 *                       project_code: KBL-042
 *                       project_category_code: KBL
 *                       description: Core Banking Upgrade
 *                       assigned_task_count: 3
 *                       assigned_units: 8
 *                       completed_tasks: 1
 *                       in_progress_tasks: 1
 *                       pending_tasks: 1
 *                       inactive_tasks: 0
 *                       total_tasks_in_project: 3
 *                       task_planned_start_date: "2026-09-01"
 *                       task_planned_end_date: "2026-10-15"
 *                       task_span_days: 45
 *                       task_actual_start_date: "2026-09-03"
 *                       task_actual_end_date: null
 *                       task_status_summary:
 *                         COMPLETED: 1
 *                         STARTED: 1
 *                         YET_TO_START: 1
 *                         INACTIVE: 0
 *                         other: 0
 *                       tasks:
 *                         - task_id: 101
 *                           task_title: API integration
 *                           status: STARTED
 *                           planned_start_date: "2026-09-01"
 *                           planned_end_date: "2026-09-15"
 *                           actual_start_date: "2026-09-03"
 *                           actual_end_date: null
 *                           no_days_required: 5
 *                           emp_id: AS01989
 *                           emp_name: Alex Smith
 *                       assigned_days: 12.5
 *                       assigned_hours: 100
 *                       logged_hours: 36
 *               noProjects:
 *                 summary: Employee without assigned projects
 *                 value:
 *                   success: true
 *                   emp_id: AS01989
 *                   total_projects: 0
 *                   total_assigned_days: 0
 *                   total_logged_hours: 0
 *                   projects: []
 *       400:
 *         description: Employee ID is required.
 *         content:
 *           application/json:
 *             example:
 *               success: false
 *               message: emp_id is required
 *       401:
 *         description: No PMS token is available for an employee with projects.
 *         content:
 *           application/json:
 *             example:
 *               success: false
 *               message: PMS token missing. Send Authorization header or configure PMS_SERVICE_TOKEN.
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */

/**
 * @swagger
 * /import-project/dashboard/all-employees:
 *   get:
 *     summary: Get utilization for all assigned employees
 *     description: |
 *       Returns employees with assignments in `task_info` or `effort_estimate`,
 *       their assigned projects, and employee-level effort and logged-hours
 *       totals. Set `include_pms=true` to add task date and status summaries
 *       from PMS. PMS failures for individual
 *       projects leave that project's enrichment fields null.
 *     tags: [Employee Utilization]
 *     parameters:
 *       - in: query
 *         name: emp_id
 *         required: false
 *         description: Limit results to one employee.
 *         schema:
 *           type: string
 *         example: AS01989
 *     
 *     responses:
 *       200:
 *         description: Employee utilization retrieved successfully.
 *         content:
 *           application/json:
 *             examples:
 *               withEmployees:
 *                 summary: Employees with assignments
 *                 value:
 *                   success: true
 *                   total_employees: 1
 *                   employees:
 *                     - emp_id: AS01989
 *                       emp_name: Alex Smith
 *                       total_projects: 1
 *                       total_assigned_days: 12.5
 *                       total_assigned_hours: 100
 *                       total_logged_hours: 36
 *                       projects:
 *                         - project_info_id: 7
 *                           pms_project_id: "2"
 *                           project_code: KBL-042
 *                           project_category_code: KBL
 *                           description: Core Banking Upgrade
 *                           task_planned_start_date: "2026-09-01"
 *                           task_planned_end_date: "2026-10-15"
 *                           task_actual_start_date: "2026-09-03"
 *                           task_actual_end_date: null
 *                           task_status_summary:
 *                             COMPLETED: 1
 *                             STARTED: 1
 *                             YET_TO_START: 1
 *                             INACTIVE: 0
 *               noEmployees:
 *                 summary: No employees with assignments
 *                 value:
 *                   success: true
 *                   total_employees: 0
 *                   employees: []
 *       401:
 *         description: PMS session is missing when `include_pms=true`.
 *         content:
 *           application/json:
 *             example:
 *               success: false
 *               message: No PMS session found for this user. Please log in again.
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
