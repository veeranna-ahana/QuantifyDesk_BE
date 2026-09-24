const express = require("express");
const router = express.Router();

const { authMiddleware } = require("../middleware/auth.middleware");
const {
  getDashboardOverview,
} = require("../controller/quantifyDashboard.controller");

// ── Dashboard ────────────────────────────────────────────────────────────
// GET /api/import-project/dashboard/overview — Cards, Project Health
// Overview, Project Status Distribution and Project Delivery Performance
// table, in one call, scoped to imported projects only.
router.get("/overview", authMiddleware, getDashboardOverview);

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
