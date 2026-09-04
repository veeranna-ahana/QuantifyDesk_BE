const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/auth.middleware');
const {
    getReconFilters,
    getReconDashboard,
    getProjectLevelRecon,
    getEmployeeLevelRecon,
    getProjectDetail,
    exportProjectLevelRecon,
    exportEmployeeLevelRecon
} = require('../controller/recon.controller');

// ─── Routes ──────────────────────────────────────────────────────

// Filter options
router.get('/filters', authMiddleware, getReconFilters);

// Dashboard & Lists
router.get('/dashboard', authMiddleware, getReconDashboard);
router.get('/project-level', authMiddleware, getProjectLevelRecon);
router.get('/employee-level', authMiddleware, getEmployeeLevelRecon);

// Export Excel Routes
router.get('/export/project-level', authMiddleware, exportProjectLevelRecon);
router.get('/export/employee-level', authMiddleware, exportEmployeeLevelRecon);

// Project Detail
router.get('/project-detail/:projectId', authMiddleware, getProjectDetail);

module.exports = router;

/**
 * @swagger
 * tags:
 *   - name: Reconciliation
 *     description: Timesheet reconciliation and analytics APIs - Dashboard, project/employee level analysis, and detailed views
 */

/**
 * @swagger
 * /reconciliation/filters:
 *   get:
 *     summary: Get Reconciliation Filter Options
 *     description: |
 *       Retrieves all filter options for the reconciliation dashboard.
 *       
 *       ### Key Features:
 *       - Returns clients from both projects and timesheet data
 *       - Shows all active projects with codes
 *       - Lists active employees from master.emp
 *       - Includes departments and managers
 *       
 *       ### Filter Categories:
 *       - **clients**: Unique client names from projects and timesheets
 *       - **projects**: All projects with ID, code, and name
 *       - **employees**: Active employees with emp_id and name
 *       - **departments**: Department names
 *       - **managers**: Project managers
 *       
 *       ### Use Cases:
 *       - Populate filter dropdowns
 *       - Dynamic filter generation
 *       - Dashboard customization
 *
 *     tags: [Reconciliation]
 *     security:
 *       - bearerAuth: []
 *
 *     responses:
 *       200:
 *         description: Filter options retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 clients:
 *                   type: array
 *                   items:
 *                     type: string
 *                   example: ["SAP Ariba", "Salesforce", "Microsoft"]
 *                 projects:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: integer
 *                       code:
 *                         type: string
 *                       name:
 *                         type: string
 *                   example:
 *                     - id: 61
 *                       code: "ARB-001"
 *                       name: "Ariba"
 *                     - id: 62
 *                       code: "CRM-001"
 *                       name: "CRM Implementation"
 *                 employees:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                       emp_id:
 *                         type: string
 *                       name:
 *                         type: string
 *                   example:
 *                     - id: "123"
 *                       emp_id: "AS02288"
 *                       name: "Bedasur Veeranna"
 *                 departments:
 *                   type: array
 *                   items:
 *                     type: string
 *                   example: ["Application Development and Automation"]
 *                 managers:
 *                   type: array
 *                   items:
 *                     type: string
 *                   example: ["John Doe", "Jane Smith"]
 *             example:
 *               clients:
 *                 - "SAP Ariba"
 *                 - "Salesforce"
 *                 - "Microsoft"
 *               projects:
 *                 - id: 61
 *                   code: "ARB-001"
 *                   name: "Ariba"
 *                 - id: 62
 *                   code: "CRM-001"
 *                   name: "CRM Implementation"
 *               employees:
 *                 - id: "123"
 *                   emp_id: "AS02288"
 *                   name: "Bedasur Veeranna"
 *                 - id: "124"
 *                   emp_id: "AS02289"
 *                   name: "John Doe"
 *               departments:
 *                 - "Application Development and Automation"
 *               managers:
 *                 - "John Doe"
 *                 - "Jane Smith"
 *       
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */

/**
 * @swagger
 * /reconciliation/dashboard:
 *   get:
 *     summary: Get Reconciliation Dashboard
 *     description: |
 *       Retrieves summary statistics for the reconciliation dashboard.
 *       
 *       ### Key Features:
 *       - Project statistics (total, with/without estimates)
 *       - Timesheet coverage metrics
 *       - Employee count
 *       - Hours comparison (estimated vs actual)
 *       - Over/under utilization counts
 *       
 *       ### Dashboard Metrics:
 *       - **total_projects**: All unique projects
 *       - **projects_with_estimates**: Projects with effort estimates
 *       - **projects_without_estimates**: Projects missing estimates
 *       - **projects_with_timesheets**: Projects with timesheet data
 *       - **projects_without_timesheets**: Projects with no timesheets
 *       - **total_employees**: Active employees from timesheets
 *       - **total_estimated_hours**: Sum of all effort estimates
 *       - **total_actual_hours**: Sum of all timesheet hours
 *       - **total_variance_hours**: Estimated - Actual
 *       - **overutilized_count**: Projects >20% over estimate
 *       - **underutilized_count**: Projects >20% under estimate
 *       
 *       ### Use Cases:
 *       - Executive dashboard
 *       - Resource health monitoring
 *       - Identify data gaps
 *       - Variance analysis
 *
 *     tags: [Reconciliation]
 *     security:
 *       - bearerAuth: []
 *
 *     responses:
 *       200:
 *         description: Dashboard data retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 total_projects:
 *                   type: integer
 *                   example: 45
 *                 projects_with_estimates:
 *                   type: integer
 *                   example: 30
 *                 projects_without_estimates:
 *                   type: integer
 *                   example: 15
 *                 projects_with_timesheets:
 *                   type: integer
 *                   example: 40
 *                 projects_without_timesheets:
 *                   type: integer
 *                   example: 5
 *                 total_employees:
 *                   type: integer
 *                   example: 25
 *                 total_estimated_hours:
 *                   type: number
 *                   format: decimal
 *                   example: 2400.00
 *                 total_actual_hours:
 *                   type: number
 *                   format: decimal
 *                   example: 2100.00
 *                 total_variance_hours:
 *                   type: number
 *                   format: decimal
 *                   example: 300.00
 *                 overutilized_count:
 *                   type: integer
 *                   example: 5
 *                 underutilized_count:
 *                   type: integer
 *                   example: 10
 *             example:
 *               total_projects: 45
 *               projects_with_estimates: 30
 *               projects_without_estimates: 15
 *               projects_with_timesheets: 40
 *               projects_without_timesheets: 5
 *               total_employees: 25
 *               total_estimated_hours: 2400.00
 *               total_actual_hours: 2100.00
 *               total_variance_hours: 300.00
 *               overutilized_count: 5
 *               underutilized_count: 10
 *       
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */

/**
 * @swagger
 * /reconciliation/project-level:
 *   get:
 *     summary: Get Project Level Reconciliation
 *     description: |
 *       Retrieves project-level reconciliation data with filtering.
 *       
 *       ### Key Features:
 *       - Compares estimated vs actual hours per project
 *       - Shows projects from system and timesheets
 *       - Calculates variance and utilization
 *       - Multi-filter support
 *       
 *       ### Filters:
 *       - **month**: Filter by month (1-12)
 *       - **year**: Filter by year (YYYY)
 *       - **clientName**: Filter by client name
 *       - **projectCode**: Filter by project code
 *       - **projectName**: Filter by project name
 *       - **employeeName**: Filter by employee name
 *       - **department**: Filter by department
 *       - **reportingManager**: Filter by reporting manager
 *       
 *       ### Status Categories:
 *       - **On Track**: Within ±20% variance
 *       - **Under Utilized**: >20% under estimate
 *       - **Over Utilized**: >20% over estimate
 *       - **No Estimate**: Missing effort estimates
 *       - **Project Not Found**: Timesheet project not in system
 *       
 *       ### Use Cases:
 *       - Project portfolio analysis
 *       - Identify at-risk projects
 *       - Resource allocation review
 *       - Budget variance analysis
 *
 *     tags: [Reconciliation]
 *     security:
 *       - bearerAuth: []
 *     
 *     parameters:
 *       - in: query
 *         name: month
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 12
 *         description: Filter by month (1-12)
 *         example: 7
 *       - in: query
 *         name: year
 *         schema:
 *           type: integer
 *         description: Filter by year (YYYY)
 *         example: 2026
 *       - in: query
 *         name: clientName
 *         schema:
 *           type: string
 *         description: Filter by client name
 *         example: "SAP Ariba"
 *       - in: query
 *         name: projectCode
 *         schema:
 *           type: string
 *         description: Filter by project code
 *         example: "ARB-001"
 *       - in: query
 *         name: projectName
 *         schema:
 *           type: string
 *         description: Filter by project name
 *         example: "Ariba"
 *       - in: query
 *         name: employeeName
 *         schema:
 *           type: string
 *         description: Filter by employee name
 *         example: "Bedasur Veeranna"
 *       - in: query
 *         name: department
 *         schema:
 *           type: string
 *         description: Filter by department
 *         example: "Application Development"
 *       - in: query
 *         name: reportingManager
 *         schema:
 *           type: string
 *         description: Filter by reporting manager
 *         example: "John Doe"
 *
 *     responses:
 *       200:
 *         description: Project level reconciliation retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   project_id:
 *                     type: integer
 *                     example: 61
 *                   project_code:
 *                     type: string
 *                     example: "ARB-001"
 *                   project_name:
 *                     type: string
 *                     example: "Ariba"
 *                   client_name:
 *                     type: string
 *                     example: "SAP Ariba"
 *                   estimated_hours:
 *                     type: string
 *                     example: "320.0"
 *                   estimated_days:
 *                     type: string
 *                     example: "40.0"
 *                   actual_hours:
 *                     type: string
 *                     example: "280.0"
 *                   actual_days:
 *                     type: string
 *                     example: "35.0"
 *                   variance_hours:
 *                     type: string
 *                     example: "40.0"
 *                   variance_pct:
 *                     type: string
 *                     example: "12.5"
 *                   employee_count:
 *                     type: integer
 *                     example: 5
 *                   in_system:
 *                     type: boolean
 *                     example: true
 *                   has_estimate:
 *                     type: boolean
 *                     example: true
 *                   status:
 *                     type: string
 *                     enum: [On Track, Under Utilized, Over Utilized, No Estimate, Project Not Found]
 *                     example: "On Track"
 *             example:
 *               - project_id: 61
 *                 project_code: "ARB-001"
 *                 project_name: "Ariba"
 *                 client_name: "SAP Ariba"
 *                 estimated_hours: "320.0"
 *                 estimated_days: "40.0"
 *                 actual_hours: "280.0"
 *                 actual_days: "35.0"
 *                 variance_hours: "40.0"
 *                 variance_pct: "12.5"
 *                 employee_count: 5
 *                 in_system: true
 *                 has_estimate: true
 *                 status: "On Track"
 *               - project_id: 62
 *                 project_code: "CRM-001"
 *                 project_name: "CRM Implementation"
 *                 client_name: "Salesforce"
 *                 estimated_hours: "240.0"
 *                 estimated_days: "30.0"
 *                 actual_hours: "180.0"
 *                 actual_days: "22.5"
 *                 variance_hours: "60.0"
 *                 variance_pct: "25.0"
 *                 employee_count: 4
 *                 in_system: true
 *                 has_estimate: true
 *                 status: "Under Utilized"
 *       
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */

/**
 * @swagger
 * /reconciliation/employee-level:
 *   get:
 *     summary: Get Employee Level Reconciliation
 *     description: |
 *       Retrieves employee-level reconciliation data with filtering.
 *       
 *       ### Key Features:
 *       - Employee-wise utilization analysis
 *       - Project assignments and timesheet comparison
 *       - Role identification
 *       - Multi-filter support
 *       
 *       ### Filters:
 *       - **month**: Filter by month (1-12)
 *       - **year**: Filter by year (YYYY)
 *       - **clientName**: Filter by client name
 *       - **projectCode**: Filter by project code
 *       - **projectName**: Filter by project name
 *       - **employeeName**: Filter by employee name
 *       - **department**: Filter by department
 *       - **reportingManager**: Filter by reporting manager
 *       
 *       ### Data Points:
 *       - **assigned_units**: Units assigned to employee
 *       - **assigned_hours**: Estimated hours from assignments
 *       - **actual_hours**: Hours logged in timesheet
 *       - **utilization_pct**: (actual / estimated) × 100
 *       - **role**: Employee's role on project
 *       - **status**: On Track, Under Utilized, Over Utilized, etc.
 *       
 *       ### Use Cases:
 *       - Employee performance review
 *       - Resource utilization analysis
 *       - Workload distribution
 *       - Capacity planning
 *
 *     tags: [Reconciliation]
 *     security:
 *       - bearerAuth: []
 *     
 *     parameters:
 *       - in: query
 *         name: month
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 12
 *         description: Filter by month (1-12)
 *         example: 7
 *       - in: query
 *         name: year
 *         schema:
 *           type: integer
 *         description: Filter by year (YYYY)
 *         example: 2026
 *       - in: query
 *         name: clientName
 *         schema:
 *           type: string
 *         description: Filter by client name
 *         example: "SAP Ariba"
 *       - in: query
 *         name: projectCode
 *         schema:
 *           type: string
 *         description: Filter by project code
 *         example: "ARB-001"
 *       - in: query
 *         name: projectName
 *         schema:
 *           type: string
 *         description: Filter by project name
 *         example: "Ariba"
 *       - in: query
 *         name: employeeName
 *         schema:
 *           type: string
 *         description: Filter by employee name
 *         example: "Bedasur Veeranna"
 *       - in: query
 *         name: department
 *         schema:
 *           type: string
 *         description: Filter by department
 *         example: "Application Development"
 *       - in: query
 *         name: reportingManager
 *         schema:
 *           type: string
 *         description: Filter by reporting manager
 *         example: "John Doe"
 *
 *     responses:
 *       200:
 *         description: Employee level reconciliation retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   employee_code:
 *                     type: string
 *                     example: "AS02288"
 *                   employee_name:
 *                     type: string
 *                     example: "Bedasur Veeranna"
 *                   reporting_manager:
 *                     type: string
 *                     example: "—"
 *                   project_id:
 *                     type: integer
 *                     example: 61
 *                   project_code:
 *                     type: string
 *                     example: "ARB-001"
 *                   project_name:
 *                     type: string
 *                     example: "Ariba"
 *                   client_name:
 *                     type: string
 *                     example: "SAP Ariba"
 *                   assigned_units:
 *                     type: string
 *                     example: "10.0"
 *                   assigned_days:
 *                     type: string
 *                     example: "10.0"
 *                   assigned_hours:
 *                     type: string
 *                     example: "80.0"
 *                   actual_hours:
 *                     type: string
 *                     example: "72.0"
 *                   actual_days:
 *                     type: string
 *                     example: "9.0"
 *                   variance_hours:
 *                     type: string
 *                     example: "8.0"
 *                   variance_pct:
 *                     type: string
 *                     example: "10.0"
 *                   utilization_pct:
 *                     type: string
 *                     example: "90.0%"
 *                   role:
 *                     type: string
 *                     example: "FE Dev"
 *                   project_exists:
 *                     type: boolean
 *                     example: true
 *                   status:
 *                     type: string
 *                     enum: [On Track, Under Utilized, Over Utilized, No Estimate, No Activity, Project Not Found]
 *                     example: "On Track"
 *             example:
 *               - employee_code: "AS02288"
 *                 employee_name: "Bedasur Veeranna"
 *                 reporting_manager: "—"
 *                 project_id: 61
 *                 project_code: "ARB-001"
 *                 project_name: "Ariba"
 *                 client_name: "SAP Ariba"
 *                 assigned_units: "10.0"
 *                 assigned_days: "10.0"
 *                 assigned_hours: "80.0"
 *                 actual_hours: "72.0"
 *                 actual_days: "9.0"
 *                 variance_hours: "8.0"
 *                 variance_pct: "10.0"
 *                 utilization_pct: "90.0%"
 *                 role: "FE Dev"
 *                 project_exists: true
 *                 status: "On Track"
 *       
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */

/**
 * @swagger
 * /reconciliation/project-detail/{projectId}:
 *   get:
 *     summary: Get Project Detail
 *     description: |
 *       Retrieves detailed reconciliation data for a specific project.
 *       
 *       ### Key Features:
 *       - Project-level summary
 *       - Role-wise breakdown
 *       - Employee-level detail
 *       - Supports both project_id and project_code
 *       
 *       ### Project Summary:
 *       - Estimated vs actual hours
 *       - Remaining hours calculation
 *       - Variance and utilization percentage
 *       
 *       ### Role Breakdown:
 *       - Per-role estimated hours
 *       - Actual hours logged per role
 *       - Variance per role
 *       
 *       ### Employee Summary:
 *       - Each employee's hours
 *       - Assignment status
 *       - Timesheet presence
 *       - Utilization percentage
 *       
 *       ### Use Cases:
 *       - Deep dive project analysis
 *       - Role-level reconciliation
 *       - Employee workload review
 *       - Project health assessment
 *
 *     tags: [Reconciliation]
 *     security:
 *       - bearerAuth: []
 *     
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema:
 *           type: string
 *         description: Project ID or Project Code
 *         example: "61"
 *       - in: query
 *         name: month
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 12
 *         description: Filter by month (1-12)
 *         example: 7
 *       - in: query
 *         name: year
 *         schema:
 *           type: integer
 *         description: Filter by year (YYYY)
 *         example: 2026
 *
 *     responses:
 *       200:
 *         description: Project detail retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 project:
 *                   type: object
 *                   properties:
 *                     project_id:
 *                       type: integer
 *                       example: 61
 *                     project_code:
 *                       type: string
 *                       example: "ARB-001"
 *                     project_name:
 *                       type: string
 *                       example: "Ariba"
 *                     client_name:
 *                       type: string
 *                       example: "SAP Ariba"
 *                     estimated_hours:
 *                       type: number
 *                       example: 320.0
 *                     estimated_days:
 *                       type: number
 *                       example: 40.0
 *                     actual_hours:
 *                       type: number
 *                       example: 280.0
 *                     actual_days:
 *                       type: number
 *                       example: 35.0
 *                     remaining_hours:
 *                       type: number
 *                       example: 40.0
 *                     remaining_days:
 *                       type: number
 *                       example: 5.0
 *                     variance_hours:
 *                       type: number
 *                       example: 40.0
 *                     variance_pct:
 *                       type: number
 *                       example: 12.5
 *                     in_system:
 *                       type: boolean
 *                       example: true
 *                     utilization_pct:
 *                       type: number
 *                       example: 87.5
 *                 roleSummary:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       role:
 *                         type: string
 *                         example: "FE Dev"
 *                       estimated_hours:
 *                         type: number
 *                         example: 100.0
 *                       estimated_days:
 *                         type: number
 *                         example: 12.5
 *                       buffer_days:
 *                         type: number
 *                         example: 2.0
 *                       buffer_hrs:
 *                         type: number
 *                         example: 16.0
 *                       actual_hours:
 *                         type: number
 *                         example: 90.0
 *                       actual_days:
 *                         type: number
 *                         example: 11.25
 *                       variance_hours:
 *                         type: number
 *                         example: 10.0
 *                       variance_pct:
 *                         type: number
 *                         example: 10.0
 *                       utilization_pct:
 *                         type: number
 *                         example: 90.0
 *                 employeeSummary:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       employee_code:
 *                         type: string
 *                         example: "AS02288"
 *                       employee_name:
 *                         type: string
 *                         example: "Bedasur Veeranna"
 *                       role:
 *                         type: string
 *                         example: "FE Dev"
 *                       assigned_units:
 *                         type: number
 *                         example: 10.0
 *                       assigned_days:
 *                         type: number
 *                         example: 10.0
 *                       assigned_hours:
 *                         type: number
 *                         example: 80.0
 *                       actual_hours:
 *                         type: number
 *                         example: 72.0
 *                       actual_days:
 *                         type: number
 *                         example: 9.0
 *                       variance_hours:
 *                         type: number
 *                         example: 8.0
 *                       variance_pct:
 *                         type: number
 *                         example: 10.0
 *                       assignment_status:
 *                         type: string
 *                         enum: [Assigned, Not Assigned]
 *                         example: "Assigned"
 *                       timesheet_status:
 *                         type: string
 *                         enum: [Present, Not Present]
 *                         example: "Present"
 *                       utilization_pct:
 *                         type: number
 *                         example: 90.0
 *             example:
 *               project:
 *                 project_id: 61
 *                 project_code: "ARB-001"
 *                 project_name: "Ariba"
 *                 client_name: "SAP Ariba"
 *                 estimated_hours: 320.0
 *                 estimated_days: 40.0
 *                 actual_hours: 280.0
 *                 actual_days: 35.0
 *                 remaining_hours: 40.0
 *                 remaining_days: 5.0
 *                 variance_hours: 40.0
 *                 variance_pct: 12.5
 *                 in_system: true
 *                 utilization_pct: 87.5
 *               roleSummary:
 *                 - role: "FE Dev"
 *                   estimated_hours: 100.0
 *                   estimated_days: 12.5
 *                   buffer_days: 2.0
 *                   buffer_hrs: 16.0
 *                   actual_hours: 90.0
 *                   actual_days: 11.25
 *                   variance_hours: 10.0
 *                   variance_pct: 10.0
 *                   utilization_pct: 90.0
 *               employeeSummary:
 *                 - employee_code: "AS02288"
 *                   employee_name: "Bedasur Veeranna"
 *                   role: "FE Dev"
 *                   assigned_units: 10.0
 *                   assigned_days: 10.0
 *                   assigned_hours: 80.0
 *                   actual_hours: 72.0
 *                   actual_days: 9.0
 *                   variance_hours: 8.0
 *                   variance_pct: 10.0
 *                   assignment_status: "Assigned"
 *                   timesheet_status: "Present"
 *                   utilization_pct: 90.0
 *       
 *       400:
 *         description: Bad Request - Invalid project identifier
 *         content:
 *           application/json:
 *             example:
 *               message: "Invalid project identifier"
 *       
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       
 *       404:
 *         description: Project not found
 *         content:
 *           application/json:
 *             example:
 *               message: "Project not found"
 *       
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */

/**
 * @swagger
 * components:
 *   responses:
 *     UnauthorizedError:
 *       description: Authentication required
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               message:
 *                 type: string
 *                 example: "Unauthorized"
 *     InternalServerError:
 *       description: Internal server error
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               error:
 *                 type: string
 *                 example: "Internal server error"
 */