
const express = require('express');
const router = express.Router();

const { authMiddleware, adminOnly } = require('../middleware/auth.middleware');
const {
  addDailyUpdate,
  getDailyUpdatesByUserId,
  getAllDailyUpdates,
  updateDailyUpdate,
  deleteDailyUpdate,
  getMeta, getDailyUpdates,
  getEmployeeProjects
} = require('../controller/dailyUpdate.controller');

// POST / — add daily update (any authenticated user)
router.post('/', authMiddleware, addDailyUpdate);

// GET /?userId= — employee: get own updates
router.get('/', authMiddleware, (req, res, next) => {
  req.params.userId = req.query.userId;
  return getDailyUpdatesByUserId(req, res, next);
});

// GET /all — admin: all updates with filters (projectId, riskLevel, dateFrom, dateTo)
router.get('/all', authMiddleware, adminOnly, getAllDailyUpdates);

// PUT /:id — update a daily update
router.put('/:id', authMiddleware, updateDailyUpdate);

// DELETE /:id — delete a daily update
router.delete('/:id', authMiddleware, deleteDailyUpdate);

//daily report meta data
 
router.get('/meta', getMeta);
router.get('/report', getDailyUpdates);
router.get('/employee-projects',authMiddleware,  getEmployeeProjects);

/**
 * @swagger
 * tags:
 *   - name: Daily Updates
 *     description: Daily progress tracking APIs - Add, update, view, and manage daily work updates
 */

/**
 * @swagger
 * /daily-updates:
 *   post:
 *     summary: Add Daily Update
 *     description: |
 *       Creates a new daily progress update for an employee's work.
 *       
 *       ### Key Features:
 *       - Track daily work progress per task
 *       - Record units completed and hours spent
 *       - Log today's tasks and tomorrow's plan
 *       - Capture risks and issues
 *       - Automatic user_id resolution from token
 *       
 *       ### Required Fields:
 *       - project_id: Project identifier
 *       - role: Employee's role (FE Dev, BE Dev, QA, etc.)
 *       - task_name: Name of the task
 *       - user_id: User identifier (can be resolved from token)
 *       - date: Date of update (YYYY-MM-DD)
 *       
 *       ### Optional Fields:
 *       - units_completed: Number of units completed (default: 0)
 *       - hours_spent: Hours spent on task (default: 0)
 *       - remarks: Additional comments
 *       - todays_task: Work done today
 *       - tomorrows_plan: Plan for tomorrow
 *       - risk_level: Low, Medium, or High
 *       - risk_description: Detailed risk description
 *       
 *       ### Risk Levels:
 *       - Low: Minor issues, no impact on timeline
 *       - Medium: Potential impact, needs attention
 *       - High: Critical issues, immediate action required
 *       
 *       ### Use Cases:
 *       - Daily standup tracking
 *       - Progress monitoring
 *       - Timesheet preparation
 *       - Risk identification
 *
 *     tags: [Daily Updates]
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
 *               - project_id
 *               - role
 *               - task_name
 *               - date
 *             properties:
 *               project_id:
 *                 type: integer
 *                 description: Project ID
 *                 example: 61
 *               role:
 *                 type: string
 *                 description: Employee role
 *                 example: "FE Dev"
 *               task_name:
 *                 type: string
 *                 description: Task name
 *                 example: "UI Design"
 *               user_id:
 *                 type: integer
 *                 description: User ID (optional, resolved from token if not provided)
 *                 example: 123
 *               date:
 *                 type: string
 *                 format: date
 *                 description: Update date (YYYY-MM-DD)
 *                 example: "2026-07-22"
 *               units_completed:
 *                 type: integer
 *                 description: Units completed today
 *                 example: 3
 *               hours_spent:
 *                 type: integer
 *                 description: Hours spent today
 *                 example: 6
 *               remarks:
 *                 type: string
 *                 description: Additional remarks
 *                 example: "Completed UI components with responsive design"
 *               todays_task:
 *                 type: string
 *                 description: Work done today
 *                 example: "Implemented login page, dashboard layout, navigation"
 *               tomorrows_plan:
 *                 type: string
 *                 description: Plan for tomorrow
 *                 example: "Profile page, API integration, testing"
 *               risk_level:
 *                 type: string
 *                 enum: [Low, Medium, High]
 *                 description: Risk level
 *                 example: "Medium"
 *               risk_description:
 *                 type: string
 *                 description: Detailed risk description
 *                 example: "API dependency might cause delay"
 *           examples:
 *             basicUpdate:
 *               summary: Basic Daily Update
 *               value:
 *                 project_id: 61
 *                 role: "FE Dev"
 *                 task_name: "UI Design"
 *                 date: "2026-07-22"
 *                 units_completed: 3
 *                 hours_spent: 6
 *             detailedUpdate:
 *               summary: Detailed Update with Plans and Risks
 *               value:
 *                 project_id: 61
 *                 role: "FE Dev"
 *                 task_name: "UI Design"
 *                 date: "2026-07-22"
 *                 units_completed: 3
 *                 hours_spent: 6
 *                 remarks: "Completed UI components with responsive design"
 *                 todays_task: "Implemented login page, dashboard layout"
 *                 tomorrows_plan: "Profile page, API integration"
 *                 risk_level: "Medium"
 *                 risk_description: "API dependency might cause delay"
 *
 *     responses:
 *       201:
 *         description: Daily update created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: integer
 *                   example: 1
 *                 project_id:
 *                   type: integer
 *                   example: 61
 *                 project_name:
 *                   type: string
 *                   example: "Ariba"
 *                 role:
 *                   type: string
 *                   example: "FE Dev"
 *                 task_name:
 *                   type: string
 *                   example: "UI Design"
 *                 user_id:
 *                   type: integer
 *                   example: 123
 *                 date:
 *                   type: string
 *                   format: date
 *                   example: "2026-07-22"
 *                 units_completed:
 *                   type: integer
 *                   example: 3
 *                 hours_spent:
 *                   type: integer
 *                   example: 6
 *                 remarks:
 *                   type: string
 *                   example: "Completed UI components with responsive design"
 *                 todays_task:
 *                   type: string
 *                   example: "Implemented login page, dashboard layout"
 *                 tomorrows_plan:
 *                   type: string
 *                   example: "Profile page, API integration"
 *                 risk_level:
 *                   type: string
 *                   example: "Medium"
 *                 risk_description:
 *                   type: string
 *                   example: "API dependency might cause delay"
 *             example:
 *               id: 1
 *               project_id: 61
 *               project_name: "Ariba"
 *               role: "FE Dev"
 *               task_name: "UI Design"
 *               user_id: 123
 *               date: "2026-07-22"
 *               units_completed: 3
 *               hours_spent: 6
 *               remarks: "Completed UI components with responsive design"
 *               todays_task: "Implemented login page, dashboard layout"
 *               tomorrows_plan: "Profile page, API integration"
 *               risk_level: "Medium"
 *               risk_description: "API dependency might cause delay"
 *       
 *       400:
 *         description: Bad Request - Missing required fields or invalid risk_level
 *         content:
 *           application/json:
 *             examples:
 *               missingFields:
 *                 value:
 *                   message: "Project, Role, Task, User and Date are required"
 *               invalidRiskLevel:
 *                 value:
 *                   message: "risk_level must be Low, Medium or High"
 *       
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */

/**
 * @swagger
 * /daily-updates:
 *   get:
 *     summary: Get User's Daily Updates
 *     description: |
 *       Retrieves daily updates for a specific user or the authenticated user.
 *       
 *       ### Key Features:
 *       - Returns all updates for a user
 *       - Ordered by date descending (latest first)
 *       - Includes project name for each update
 *       - Auto-resolves user_id from token if not provided
 *       
 *       ### Use Cases:
 *       - Employee's own update history
 *       - Manager viewing team member updates
 *       - Progress tracking over time
 *
 *     tags: [Daily Updates]
 *     security:
 *       - bearerAuth: []
 *     
 *     parameters:
 *       - in: query
 *         name: userId
 *         schema:
 *           type: integer
 *         description: User ID (optional, defaults to authenticated user)
 *         example: 123
 *
 *     responses:
 *       200:
 *         description: Daily updates retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id:
 *                     type: integer
 *                     example: 1
 *                   project_id:
 *                     type: integer
 *                     example: 61
 *                   project_name:
 *                     type: string
 *                     example: "Ariba"
 *                   role:
 *                     type: string
 *                     example: "FE Dev"
 *                   task_name:
 *                     type: string
 *                     example: "UI Design"
 *                   user_id:
 *                     type: integer
 *                     example: 123
 *                   date:
 *                     type: string
 *                     format: date
 *                     example: "2026-07-22"
 *                   units_completed:
 *                     type: integer
 *                     example: 3
 *                   hours_spent:
 *                     type: integer
 *                     example: 6
 *                   remarks:
 *                     type: string
 *                     example: "Completed UI components"
 *                   todays_task:
 *                     type: string
 *                     example: "Implemented login page"
 *                   tomorrows_plan:
 *                     type: string
 *                     example: "Profile page"
 *                   risk_level:
 *                     type: string
 *                     enum: [Low, Medium, High]
 *                     example: "Medium"
 *                   risk_description:
 *                     type: string
 *                     example: "API dependency might cause delay"
 *             example:
 *               - id: 1
 *                 project_id: 61
 *                 project_name: "Ariba"
 *                 role: "FE Dev"
 *                 task_name: "UI Design"
 *                 user_id: 123
 *                 date: "2026-07-22"
 *                 units_completed: 3
 *                 hours_spent: 6
 *                 remarks: "Completed UI components"
 *                 todays_task: "Implemented login page"
 *                 tomorrows_plan: "Profile page"
 *                 risk_level: "Medium"
 *                 risk_description: "API dependency might cause delay"
 *               - id: 2
 *                 project_id: 61
 *                 project_name: "Ariba"
 *                 role: "FE Dev"
 *                 task_name: "API Integration"
 *                 user_id: 123
 *                 date: "2026-07-21"
 *                 units_completed: 2
 *                 hours_spent: 4
 *                 remarks: "API endpoints created"
 *                 todays_task: "Created GET and POST endpoints"
 *                 tomorrows_plan: "PUT and DELETE endpoints"
 *                 risk_level: "Low"
 *                 risk_description: null
 *
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */

/**
 * @swagger
 * /daily-updates/all:
 *   get:
 *     summary: Get All Daily Updates (Admin Only)
 *     description: |
 *       Retrieves all daily updates across all employees with filtering options.
 *       
 *       ### Key Features:
 *       - View all employee updates in one place
 *       - Filter by project, risk level, or date range
 *       - Includes employee name for each update
 *       - Ordered by date descending (latest first)
 *       
 *       ### Filters:
 *       - **projectId**: Filter updates for specific project
 *       - **riskLevel**: Filter by Low, Medium, or High
 *       - **dateFrom**: Start date (YYYY-MM-DD)
 *       - **dateTo**: End date (YYYY-MM-DD)
 *       
 *       ### Access Control:
 *       - Admin only (requires admin privileges)
 *       - Used for management dashboards
 *       
 *       ### Use Cases:
 *       - Management dashboard
 *       - Project status tracking
 *       - Risk monitoring across projects
 *       - Team performance monitoring
 *
 *     tags: [Daily Updates]
 *     security:
 *       - bearerAuth: []
 *     
 *     parameters:
 *       - in: query
 *         name: projectId
 *         schema:
 *           type: integer
 *         description: Filter by project ID
 *         example: 61
 *       - in: query
 *         name: riskLevel
 *         schema:
 *           type: string
 *           enum: [Low, Medium, High]
 *         description: Filter by risk level
 *         example: "High"
 *       - in: query
 *         name: dateFrom
 *         schema:
 *           type: string
 *           format: date
 *         description: Start date (YYYY-MM-DD)
 *         example: "2026-07-01"
 *       - in: query
 *         name: dateTo
 *         schema:
 *           type: string
 *           format: date
 *         description: End date (YYYY-MM-DD)
 *         example: "2026-07-31"
 *
 *     responses:
 *       200:
 *         description: All daily updates retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id:
 *                     type: integer
 *                     example: 1
 *                   project_id:
 *                     type: integer
 *                     example: 61
 *                   project_name:
 *                     type: string
 *                     example: "Ariba"
 *                   role:
 *                     type: string
 *                     example: "FE Dev"
 *                   task_name:
 *                     type: string
 *                     example: "UI Design"
 *                   user_id:
 *                     type: integer
 *                     example: 123
 *                   user_name:
 *                     type: string
 *                     example: "John Doe"
 *                   date:
 *                     type: string
 *                     format: date
 *                     example: "2026-07-22"
 *                   units_completed:
 *                     type: integer
 *                     example: 3
 *                   hours_spent:
 *                     type: integer
 *                     example: 6
 *                   remarks:
 *                     type: string
 *                     example: "Completed UI components"
 *                   todays_task:
 *                     type: string
 *                     example: "Implemented login page"
 *                   tomorrows_plan:
 *                     type: string
 *                     example: "Profile page"
 *                   risk_level:
 *                     type: string
 *                     enum: [Low, Medium, High]
 *                     example: "Medium"
 *                   risk_description:
 *                     type: string
 *                     example: "API dependency might cause delay"
 *             example:
 *               - id: 1
 *                 project_id: 61
 *                 project_name: "Ariba"
 *                 role: "FE Dev"
 *                 task_name: "UI Design"
 *                 user_id: 123
 *                 user_name: "John Doe"
 *                 date: "2026-07-22"
 *                 units_completed: 3
 *                 hours_spent: 6
 *                 remarks: "Completed UI components"
 *                 todays_task: "Implemented login page"
 *                 tomorrows_plan: "Profile page"
 *                 risk_level: "Medium"
 *                 risk_description: "API dependency might cause delay"
 *               - id: 2
 *                 project_id: 62
 *                 project_name: "CRM Project"
 *                 role: "BE Dev"
 *                 task_name: "API Development"
 *                 user_id: 124
 *                 user_name: "Jane Smith"
 *                 date: "2026-07-22"
 *                 units_completed: 2
 *                 hours_spent: 8
 *                 remarks: "API endpoints created"
 *                 todays_task: "Created user management APIs"
 *                 tomorrows_plan: "Payment integration"
 *                 risk_level: "High"
 *                 risk_description: "Third-party payment gateway issues"
 *
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       
 *       403:
 *         description: Forbidden - Admin access required
 *         content:
 *           application/json:
 *             example:
 *               message: "Admin access required"
 *       
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */

/**
 * @swagger
 * /daily-updates/{id}:
 *   put:
 *     summary: Update Daily Update
 *     description: |
 *       Updates an existing daily update entry.
 *       
 *       ### Key Features:
 *       - Update all fields of a daily update
 *       - Validates risk_level if provided
 *       - Returns success message on update
 *       
 *       ### Update Rules:
 *       - All fields are optional (only provided fields are updated)
 *       - If risk_level provided, validates against enum
 *       - Cannot update if update doesn't exist
 *       
 *       ### Use Cases:
 *       - Correct mistakes in daily updates
 *       - Update progress after clarification
 *       - Add missing information
 *
 *     tags: [Daily Updates]
 *     security:
 *       - bearerAuth: []
 *     
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Daily update ID
 *         example: 1
 *     
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               project_id:
 *                 type: integer
 *                 description: Project ID
 *                 example: 61
 *               role:
 *                 type: string
 *                 description: Employee role
 *                 example: "FE Dev"
 *               task_name:
 *                 type: string
 *                 description: Task name
 *                 example: "UI Design"
 *               date:
 *                 type: string
 *                 format: date
 *                 description: Update date (YYYY-MM-DD)
 *                 example: "2026-07-22"
 *               units_completed:
 *                 type: integer
 *                 description: Units completed
 *                 example: 4
 *               hours_spent:
 *                 type: integer
 *                 description: Hours spent
 *                 example: 7
 *               remarks:
 *                 type: string
 *                 description: Additional remarks
 *                 example: "Updated with new requirements"
 *               todays_task:
 *                 type: string
 *                 description: Work done today
 *                 example: "Implemented responsive design"
 *               tomorrows_plan:
 *                 type: string
 *                 description: Plan for tomorrow
 *                 example: "Testing and deployment"
 *               risk_level:
 *                 type: string
 *                 enum: [Low, Medium, High]
 *                 description: Risk level
 *                 example: "Low"
 *               risk_description:
 *                 type: string
 *                 description: Detailed risk description
 *                 example: "Minor CSS issues"
 *           example:
 *             units_completed: 4
 *             hours_spent: 7
 *             remarks: "Updated with new requirements"
 *             todays_task: "Implemented responsive design"
 *             tomorrows_plan: "Testing and deployment"
 *             risk_level: "Low"
 *             risk_description: "Minor CSS issues"
 *
 *     responses:
 *       200:
 *         description: Daily update updated successfully
 *         content:
 *           application/json:
 *             example:
 *               message: "Updated successfully"
 *       
 *       400:
 *         description: Bad Request - Invalid risk_level
 *         content:
 *           application/json:
 *             example:
 *               message: "risk_level must be Low, Medium or High"
 *       
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       
 *       404:
 *         description: Daily update not found
 *       
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */

/**
 * @swagger
 * /daily-updates/{id}:
 *   delete:
 *     summary: Delete Daily Update
 *     description: |
 *       Deletes a daily update from the system.
 *       
 *       ### Key Features:
 *       - Removes daily update record
 *       - Returns success message on deletion
 *       
 *       ### Use Cases:
 *       - Remove incorrect entries
 *       - Clean up test data
 *       - Delete duplicate updates
 *
 *     tags: [Daily Updates]
 *     security:
 *       - bearerAuth: []
 *     
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Daily update ID
 *         example: 1
 *
 *     responses:
 *       200:
 *         description: Daily update deleted successfully
 *         content:
 *           application/json:
 *             example:
 *               message: "Daily update deleted successfully"
 *       
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       
 *       404:
 *         description: Daily update not found
 *       
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */

/**
 * @swagger
 * /daily-updates/meta:
 *   get:
 *     summary: Get Meta Data for Filters
 *     description: |
 *       Returns meta data required for filter dropdowns in the UI.
 *       
 *       ### Key Features:
 *       - Returns all dates from Jan 1, 2025 to today
 *       - Returns all projects for filtering
 *       - Sorted dates descending (latest first)
 *       - Used for filter dropdowns in admin dashboard
 *       
 *       ### Use Cases:
 *       - Populate date picker
 *       - Populate project selector
 *       - Admin dashboard filters
 *
 *     tags: [Daily Updates]
 *     
 *     responses:
 *       200:
 *         description: Meta data retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 dates:
 *                   type: array
 *                   items:
 *                     type: string
 *                     format: date
 *                   example: ["2026-07-22", "2026-07-21", "2026-07-20", ...]
 *                 projects:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: integer
 *                         example: 61
 *                       project_name:
 *                         type: string
 *                         example: "Ariba"
 *             example:
 *               success: true
 *               dates:
 *                 - "2026-07-22"
 *                 - "2026-07-21"
 *                 - "2026-07-20"
 *               projects:
 *                 - id: 61
 *                   project_name: "Ariba"
 *                 - id: 62
 *                   project_name: "CRM Project"
 *                 - id: 63
 *                   project_name: "E-commerce Platform"
 *       
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */

/**
 * @swagger
 * /daily-updates/report:
 *   get:
 *     summary: Get Daily Updates Report (Assignment Progress View)
 *     description: |
 *       Retrieves daily updates from assignment_progress table with enhanced details.
 *       
 *       ### Key Features:
 *       - Includes employee details from master.emp
 *       - Shows previous day's plan for comparison
 *       - Includes work status and availability
 *       - Shows risks and remarks
 *       
 *       ### Data Sources:
 *       - `assignment_progress`: Daily progress records
 *       - `master.emp`: Employee details
 *       - `projects`: Project information
 *       
 *       ### Previous Day Plan:
 *       - Automatically fetches previous day's planned tasks
 *       - Helps track if plan was executed
 *       
 *       ### Filters:
 *       - **date**: Filter by specific date (YYYY-MM-DD)
 *       - **project_id**: Filter by project
 *       - **user_id**: Filter by employee ID (emp_id)
 *       
 *       ### Use Cases:
 *       - Progress report generation
 *       - Plan vs actual comparison
 *       - Employee productivity tracking
 *       - Daily standup reporting
 *
 *     tags: [Daily Updates]
 *     
 *     parameters:
 *       - in: query
 *         name: date
 *         schema:
 *           type: string
 *           format: date
 *         description: Filter by date (YYYY-MM-DD)
 *         example: "2026-07-22"
 *       - in: query
 *         name: project_id
 *         schema:
 *           type: integer
 *         description: Filter by project ID
 *         example: 61
 *       - in: query
 *         name: user_id
 *         schema:
 *           type: string
 *         description: Filter by employee ID (emp_id)
 *         example: "AS02288"
 *
 *     responses:
 *       200:
 *         description: Daily updates report retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: integer
 *                         example: 1
 *                       date:
 *                         type: string
 *                         format: date
 *                         example: "2026-07-22"
 *                       emp_id:
 *                         type: string
 *                         example: "AS02288"
 *                       employee_name:
 *                         type: string
 *                         example: "Bedasur Veeranna"
 *                       employee_email:
 *                         type: string
 *                         format: email
 *                         example: "veeranna.b@company.com"
 *                       u_id:
 *                         type: string
 *                         example: "123"
 *                       employee_status:
 *                         type: string
 *                         example: "Active"
 *                       project_id:
 *                         type: integer
 *                         example: 61
 *                       project_name:
 *                         type: string
 *                         example: "Ariba"
 *                       role:
 *                         type: string
 *                         example: "FE Dev"
 *                       task_name:
 *                         type: string
 *                         example: "UI Design"
 *                       working_status:
 *                         type: string
 *                         enum: [PENDING, APPROVED, REJECTED]
 *                         example: "APPROVED"
 *                       units_completed:
 *                         type: integer
 *                         example: 3
 *                       total_time_needed:
 *                         type: string
 *                         example: "6 hours"
 *                       done_yesterday:
 *                         type: string
 *                         example: "Created wireframes"
 *                       todays_tasks:
 *                         type: string
 *                         example: "Implemented login page"
 *                       previousDayPlan:
 *                         type: string
 *                         example: "Will implement login page"
 *                       risks:
 *                         type: string
 *                         example: "API delay"
 *                       remarks:
 *                         type: string
 *                         example: "On track"
 *                       availability:
 *                         type: string
 *                         example: "Available"
 *             example:
 *               success: true
 *               data:
 *                 - id: 1
 *                   date: "2026-07-22"
 *                   emp_id: "AS02288"
 *                   employee_name: "Bedasur Veeranna"
 *                   employee_email: "veeranna.b@company.com"
 *                   u_id: "123"
 *                   employee_status: "Active"
 *                   project_id: 61
 *                   project_name: "Ariba"
 *                   role: "FE Dev"
 *                   task_name: "UI Design"
 *                   working_status: "APPROVED"
 *                   units_completed: 3
 *                   total_time_needed: "6 hours"
 *                   done_yesterday: "Created wireframes"
 *                   todays_tasks: "Implemented login page"
 *                   previousDayPlan: "Will implement login page"
 *                   risks: "API delay"
 *                   remarks: "On track"
 *                   availability: "Available"
 *       
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */

/**
 * @swagger
 * /daily-updates/employee-projects:
 *   get:
 *     summary: Get Employee's Assigned Projects
 *     description: |
 *       Retrieves projects assigned to the authenticated employee.
 *       
 *       ### Key Features:
 *       - Returns projects where employee has assignments
 *       - Used for project dropdown in daily update form
 *       - Restricts employees to their assigned projects only
 *       
 *       ### Access Control:
 *       - Users can only see projects they are assigned to
 *       - Uses emp_id from authentication token
 *       - No admin override for employee view
 *       
 *       ### Use Cases:
 *       - Populate project dropdown in daily update form
 *       - Ensure employees only update their assigned projects
 *       - Employee dashboard project list
 *
 *     tags: [Daily Updates]
 *     security:
 *       - bearerAuth: []
 *
 *     responses:
 *       200:
 *         description: Employee projects retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 projects:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: integer
 *                         example: 61
 *                       project_name:
 *                         type: string
 *                         example: "Ariba"
 *             example:
 *               success: true
 *               projects:
 *                 - id: 61
 *                   project_name: "Ariba"
 *                 - id: 62
 *                   project_name: "CRM Project"
 *                 - id: 65
 *                   project_name: "Mobile App Development"
 *       
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
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

module.exports = router;