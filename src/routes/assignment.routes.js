
const express = require('express');
const router  = express.Router();
const { authMiddleware, adminOnly } = require('../middleware/auth.middleware');
const {
  getCatalog,
  getEffortEstimates,
  getTaskLoads,
  upsertTaskLoad,
  bulkUpsertTaskLoads,
  getProjectSummary,
  getAssignmentsByProject,
  addAssignment,
  updateAssignment,
  deleteAssignment,
  getEmployeeAssignments
} = require('../controller/assignment.controller');

// Catalog — both roles need it
router.get ('/catalog',                   authMiddleware,            getCatalog);

// Effort estimates — fetch from effort_estimates table
router.get ('/effort-estimates/:projectId', authMiddleware, getEffortEstimates);

// Task loads — admin only
router.get ('/task-loads/:projectId',     authMiddleware, getTaskLoads);
router.post('/task-loads/bulk',           authMiddleware, bulkUpsertTaskLoads);
router.post('/task-loads',               authMiddleware, upsertTaskLoad);

// Summary
router.get ('/summary/:projectId',        authMiddleware, getProjectSummary);

// Assignments CRUD
router.get   ('/',    authMiddleware, getAssignmentsByProject);
router.get('/employee-assignments', getEmployeeAssignments);
router.post  ('/',    authMiddleware, addAssignment);
router.put   ('/:id', authMiddleware, updateAssignment);
router.delete('/:id', authMiddleware, deleteAssignment);

/**
 * @swagger
 * tags:
 *   - name: Assignments
 *     description: Assignment management APIs - Create, update, delete, and view task assignments for projects
 */

/**
 * @swagger
 * /assignments/catalog:
 *   get:
 *     summary: Get Role-Task Catalog
 *     description: |
 *       Retrieves the master catalog of all available roles and their associated tasks.
 *       
 *       ### Key Features:
 *       - Returns flat list and grouped by role for easy frontend consumption
 *       - Includes role, task_name, unit_type, and notes
 *       - Used as reference when creating task loads and assignments
 *       
 *       ### Use Cases:
 *       - Populate dropdown menus for task selection
 *       - Understand available task types per role
 *       - View unit types (hours/days/story points) per task
 *
 *     tags: [Assignments]
 *     security:
 *       - bearerAuth: []
 *
 *     responses:
 *       200:
 *         description: Catalog retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 flat:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: integer
 *                         example: 1
 *                       role:
 *                         type: string
 *                         example: "FE Dev"
 *                       task_name:
 *                         type: string
 *                         example: "UI Design"
 *                       unit_type:
 *                         type: string
 *                         example: "hours"
 *                       notes:
 *                         type: string
 *                         example: "Frontend development tasks"
 *                 grouped:
 *                   type: object
 *                   additionalProperties:
 *                     type: array
 *                     items:
 *                       type: object
 *                       properties:
 *                         id:
 *                           type: integer
 *                           example: 1
 *                         role:
 *                           type: string
 *                           example: "FE Dev"
 *                         task_name:
 *                           type: string
 *                           example: "UI Design"
 *             example:
 *               flat:
 *                 - id: 1
 *                   role: "FE Dev"
 *                   task_name: "UI Design"
 *                   unit_type: "hours"
 *                   notes: "Frontend UI development"
 *                 - id: 2
 *                   role: "BE Dev"
 *                   task_name: "API Development"
 *                   unit_type: "hours"
 *                   notes: "Backend API implementation"
 *               grouped:
 *                 "FE Dev":
 *                   - id: 1
 *                     role: "FE Dev"
 *                     task_name: "UI Design"
 *                     unit_type: "hours"
 *                     notes: "Frontend UI development"
 *                 "BE Dev":
 *                   - id: 2
 *                     role: "BE Dev"
 *                     task_name: "API Development"
 *                     unit_type: "hours"
 *                     notes: "Backend API implementation"
 *
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */

/**
 * @swagger
 * /assignments/effort-estimates/{projectId}:
 *   get:
 *     summary: Get Effort Estimates by Project
 *     description: |
 *       Retrieves role-level effort estimates for a specific project.
 *       
 *       ### Key Features:
 *       - Returns effort estimates per role (FE Dev, BE Dev, QA, etc.)
 *       - Includes effort days, hours, buffer, and total hours
 *       - Provides unit and unit_label for each role
 *       - Returns both array and keyed-by-role format
 *       
 *       ### Source:
 *       - Data from `effort_estimates` table
 *       - Used for capacity planning and resource allocation
 *       
 *       ### Use Cases:
 *       - Determine planned effort for each role
 *       - Calculate remaining capacity
 *       - Resource planning across roles
 *
 *     tags: [Assignments]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema:
 *           type: integer
 *         description: Project ID
 *         example: 61
 *
 *     responses:
 *       200:
 *         description: Effort estimates retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 estimates:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: integer
 *                         example: 1
 *                       project_id:
 *                         type: integer
 *                         example: 61
 *                       role:
 *                         type: string
 *                         example: "FE Dev"
 *                       effort_days:
 *                         type: number
 *                         format: decimal
 *                         example: 10.50
 *                       effort_hrs:
 *                         type: number
 *                         format: decimal
 *                         example: 84.00
 *                       buffer_days:
 *                         type: number
 *                         format: decimal
 *                         example: 2.00
 *                       buffer_hrs:
 *                         type: number
 *                         format: decimal
 *                         example: 16.00
 *                       total_hrs:
 *                         type: number
 *                         format: decimal
 *                         example: 100.00
 *                       units:
 *                         type: number
 *                         format: decimal
 *                         example: 20.00
 *                       unit_label:
 *                         type: string
 *                         example: "Story Points"
 *                 byRole:
 *                   type: object
 *                   additionalProperties:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: integer
 *                       project_id:
 *                         type: integer
 *                       role:
 *                         type: string
 *                       effort_days:
 *                         type: number
 *                       effort_hrs:
 *                         type: number
 *                       buffer_days:
 *                         type: number
 *                       buffer_hrs:
 *                         type: number
 *                       total_hrs:
 *                         type: number
 *                       units:
 *                         type: number
 *                       unit_label:
 *                         type: string
 *             example:
 *               estimates:
 *                 - id: 1
 *                   project_id: 61
 *                   role: "FE Dev"
 *                   effort_days: 10.50
 *                   effort_hrs: 84.00
 *                   buffer_days: 2.00
 *                   buffer_hrs: 16.00
 *                   total_hrs: 100.00
 *                   units: 20.00
 *                   unit_label: "Story Points"
 *                 - id: 2
 *                   project_id: 61
 *                   role: "BE Dev"
 *                   effort_days: 15.00
 *                   effort_hrs: 120.00
 *                   buffer_days: 3.00
 *                   buffer_hrs: 24.00
 *                   total_hrs: 144.00
 *                   units: 30.00
 *                   unit_label: "Story Points"
 *
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       404:
 *         description: Project not found
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */

/**
 * @swagger
 * /assignments/task-loads/{projectId}:
 *   get:
 *     summary: Get Task Loads by Project
 *     description: |
 *       Retrieves all task loads (planned work) for a specific project.
 *       
 *       ### Key Features:
 *       - Returns planned units, estimated days, and hours per role-task combination
 *       - Includes effort estimates from `effort_estimates` table
 *       - Includes catalog unit type and notes for reference
 *       - Provides total planned units and total estimated hours
 *       
 *       ### Source Tables:
 *       - `project_task_loads`: Planned work
 *       - `role_task_catalog`: Task definitions
 *       - `effort_estimates`: Effort estimates
 *       
 *       ### Use Cases:
 *       - View all planned work for a project
 *       - Understand capacity requirements per role
 *       - Identify if planned work exceeds effort estimates
 *
 *     tags: [Assignments]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema:
 *           type: integer
 *         description: Project ID
 *         example: 61
 *
 *     responses:
 *       200:
 *         description: Task loads retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 loads:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: integer
 *                       project_id:
 *                         type: integer
 *                       role:
 *                         type: string
 *                       task_name:
 *                         type: string
 *                       planned_units:
 *                         type: integer
 *                       estimated_days:
 *                         type: number
 *                         format: decimal
 *                       estimated_hours:
 *                         type: number
 *                         format: decimal
 *                       effort_days:
 *                         type: number
 *                         format: decimal
 *                       effort_hrs:
 *                         type: number
 *                         format: decimal
 *                       unit_type:
 *                         type: string
 *                       notes:
 *                         type: string
 *                 total_load:
 *                   type: integer
 *                   description: Total planned units across all tasks
 *                 total_estimated_hours:
 *                   type: number
 *                   description: Total estimated hours across all tasks
 *             example:
 *               loads:
 *                 - id: 1
 *                   project_id: 61
 *                   role: "FE Dev"
 *                   task_name: "UI Design"
 *                   planned_units: 10
 *                   estimated_days: 5.00
 *                   estimated_hours: 40.00
 *                   effort_days: 10.50
 *                   effort_hrs: 84.00
 *                   unit_type: "hours"
 *                   notes: "Frontend UI development"
 *               total_load: 50
 *               total_estimated_hours: 200.00
 *
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       404:
 *         description: Project not found
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */

/**
 * @swagger
 * /assignments/task-loads:
 *   post:
 *     summary: Create/Update Single Task Load
 *     description: |
 *       Creates or updates a single task load entry for a project.
 *       
 *       ### Validation:
 *       - Requires project_id, role, and task_name
 *       - Uses ON DUPLICATE KEY UPDATE for upsert
 *       - If record exists, updates planned_units
 *       
 *       ### Important Notes:
 *       - This creates planned work that can later be assigned to employees
 *       - Task loads are referenced when creating assignments
 *       - Cannot create task load without existing project
 *
 *     tags: [Assignments]
 *     security:
 *       - bearerAuth: []
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
 *             properties:
 *               project_id:
 *                 type: integer
 *                 description: Project ID
 *                 example: 61
 *               role:
 *                 type: string
 *                 description: Role name (must match catalog)
 *                 example: "FE Dev"
 *               task_name:
 *                 type: string
 *                 description: Task name (must match catalog)
 *                 example: "UI Design"
 *               planned_units:
 *                 type: integer
 *                 description: Number of units planned for this task
 *                 example: 10
 *           example:
 *             project_id: 61
 *             role: "FE Dev"
 *             task_name: "UI Design"
 *             planned_units: 10
 *
 *     responses:
 *       200:
 *         description: Task load saved successfully
 *         content:
 *           application/json:
 *             example:
 *               message: "Saved"
 *       400:
 *         description: Bad Request - Missing required fields
 *         content:
 *           application/json:
 *             example:
 *               message: "project_id, role, task_name required"
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */

/**
 * @swagger
 * /assignments/task-loads/bulk:
 *   post:
 *     summary: Bulk Create/Update Task Loads
 *     description: |
 *       Creates or updates multiple task load entries for a project in a single request.
 *       
 *       ### Features:
 *       - Upsert multiple task loads at once
 *       - Each task load can have estimated_days and estimated_hours
 *       - Returns updated task loads with total load
 *       
 *       ### Validation:
 *       - Requires project_id and loads array
 *       - Each load object must have role and task_name
 *       - Planned units, estimated days, hours are optional (default 0)
 *       
 *       ### Use Cases:
 *       - Bulk upload task loads from project planning
 *       - Update multiple tasks simultaneously
 *       - Sync task loads with project plan
 *
 *     tags: [Assignments]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - project_id
 *               - loads
 *             properties:
 *               project_id:
 *                 type: integer
 *                 description: Project ID
 *                 example: 61
 *               loads:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required:
 *                     - role
 *                     - task_name
 *                   properties:
 *                     role:
 *                       type: string
 *                       description: Role name
 *                       example: "FE Dev"
 *                     task_name:
 *                       type: string
 *                       description: Task name
 *                       example: "UI Design"
 *                     planned_units:
 *                       type: integer
 *                       description: Planned units
 *                       example: 10
 *                     estimated_days:
 *                       type: number
 *                       format: decimal
 *                       description: Estimated days for this task
 *                       example: 5.00
 *                     estimated_hours:
 *                       type: number
 *                       format: decimal
 *                       description: Estimated hours for this task
 *                       example: 40.00
 *           example:
 *             project_id: 61
 *             loads:
 *               - role: "FE Dev"
 *                 task_name: "UI Design"
 *                 planned_units: 10
 *                 estimated_days: 5.00
 *                 estimated_hours: 40.00
 *               - role: "BE Dev"
 *                 task_name: "API Development"
 *                 planned_units: 8
 *                 estimated_days: 4.00
 *                 estimated_hours: 32.00
 *               - role: "QA"
 *                 task_name: "Testing"
 *                 planned_units: 5
 *                 estimated_days: 2.50
 *                 estimated_hours: 20.00
 *
 *     responses:
 *       200:
 *         description: Task loads saved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 loads:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: integer
 *                       project_id:
 *                         type: integer
 *                       role:
 *                         type: string
 *                       task_name:
 *                         type: string
 *                       planned_units:
 *                         type: integer
 *                       estimated_days:
 *                         type: number
 *                         format: decimal
 *                       estimated_hours:
 *                         type: number
 *                         format: decimal
 *                       unit_type:
 *                         type: string
 *                 total_load:
 *                   type: integer
 *                   description: Total planned units across all tasks
 *             example:
 *               loads:
 *                 - id: 1
 *                   project_id: 61
 *                   role: "FE Dev"
 *                   task_name: "UI Design"
 *                   planned_units: 10
 *                   estimated_days: 5.00
 *                   estimated_hours: 40.00
 *                   unit_type: "hours"
 *                 - id: 2
 *                   project_id: 61
 *                   role: "BE Dev"
 *                   task_name: "API Development"
 *                   planned_units: 8
 *                   estimated_days: 4.00
 *                   estimated_hours: 32.00
 *                   unit_type: "hours"
 *               total_load: 23
 *       400:
 *         description: Bad Request - Missing required fields
 *         content:
 *           application/json:
 *             example:
 *               message: "project_id and loads[] required"
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */

/**
 * @swagger
 * /assignments/summary/{projectId}:
 *   get:
 *     summary: Get Project Summary
 *     description: |
 *       Retrieves comprehensive project summary including all task loads, assignments, and progress.
 *       
 *       ### Key Features:
 *       - Shows planned units, assigned, completed, pending, and unassigned per task
 *       - Includes effort estimates (days and hours) per role
 *       - Provides total summary at project level
 *       - Calculates pending work (assigned but not completed)
 *       - Shows unassigned work (planned but not assigned)
 *       
 *       ### Data Points:
 *       - Per task: role, task_name, planned_units, total_assigned, total_completed, unassigned, pending
 *       - Per task: effort_days, effort_hrs, unit_type
 *       - Totals: planned, effort_days, effort_hours, assigned, completed, pending
 *       
 *       ### Use Cases:
 *       - Project progress tracking
 *       - Identify work not yet assigned
 *       - Calculate remaining work
 *       - Track completion percentage
 *
 *     tags: [Assignments]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema:
 *           type: integer
 *         description: Project ID
 *         example: 61
 *
 *     responses:
 *       200:
 *         description: Project summary retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 rows:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       role:
 *                         type: string
 *                         example: "FE Dev"
 *                       task_name:
 *                         type: string
 *                         example: "UI Design"
 *                       planned_units:
 *                         type: integer
 *                         example: 10
 *                       effort_days:
 *                         type: number
 *                         format: decimal
 *                         example: 5.00
 *                       effort_hrs:
 *                         type: number
 *                         format: decimal
 *                         example: 40.00
 *                       unit_type:
 *                         type: string
 *                         example: "hours"
 *                       total_assigned:
 *                         type: number
 *                         format: decimal
 *                         example: 8.00
 *                       total_completed:
 *                         type: number
 *                         format: decimal
 *                         example: 6.00
 *                       unassigned:
 *                         type: number
 *                         format: decimal
 *                         example: 2.00
 *                       pending:
 *                         type: number
 *                         format: decimal
 *                         example: 2.00
 *                 totals:
 *                   type: object
 *                   properties:
 *                     total_planned:
 *                       type: integer
 *                       example: 50
 *                     total_effort_days:
 *                       type: number
 *                       format: decimal
 *                       example: 25.00
 *                     total_effort_hours:
 *                       type: number
 *                       format: decimal
 *                       example: 200.00
 *                     total_assigned:
 *                       type: number
 *                       format: decimal
 *                       example: 40.00
 *                     total_completed:
 *                       type: number
 *                       format: decimal
 *                       example: 30.00
 *                     total_pending:
 *                       type: number
 *                       format: decimal
 *                       example: 10.00
 *             example:
 *               rows:
 *                 - role: "FE Dev"
 *                   task_name: "UI Design"
 *                   planned_units: 10
 *                   effort_days: 5.00
 *                   effort_hrs: 40.00
 *                   unit_type: "hours"
 *                   total_assigned: 8.00
 *                   total_completed: 6.00
 *                   unassigned: 2.00
 *                   pending: 2.00
 *                 - role: "BE Dev"
 *                   task_name: "API Development"
 *                   planned_units: 8
 *                   effort_days: 4.00
 *                   effort_hrs: 32.00
 *                   unit_type: "hours"
 *                   total_assigned: 8.00
 *                   total_completed: 5.00
 *                   unassigned: 0.00
 *                   pending: 3.00
 *               totals:
 *                 total_planned: 50
 *                 total_effort_days: 25.00
 *                 total_effort_hours: 200.00
 *                 total_assigned: 40.00
 *                 total_completed: 30.00
 *                 total_pending: 10.00
 *
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       404:
 *         description: Project not found
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */

/**
 * @swagger
 * /assignments:
 *   get:
 *     summary: Get Assignments by Project
 *     description: |
 *       Retrieves all assignments for a specific project with employee details.
 *       
 *       ### Key Features:
 *       - Returns all assignments (role-task-employee mapping)
 *       - Includes employee name from master.emp table
 *       - Includes project name and effort estimates
 *       - Shows units assigned per employee per task
 *       
 *       ### Source Tables:
 *       - `assignments`: Core assignment data
 *       - `master.emp`: Employee details
 *       - `projects`: Project information
 *       - `effort_estimates`: Effort estimates
 *       
 *       ### Use Cases:
 *       - View all assignments for a project
 *       - See who is working on what
 *       - Track workload distribution
 *       - Identify resource allocation
 *
 *     tags: [Assignments]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: projectId
 *         required: true
 *         schema:
 *           type: integer
 *         description: Project ID
 *         example: 61
 *
 *     responses:
 *       200:
 *         description: Assignments retrieved successfully
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
 *                   user_id:
 *                     type: integer
 *                     example: 123
 *                   emp_id:
 *                     type: string
 *                     example: "AS02288"
 *                   user_name:
 *                     type: string
 *                     example: "Bedasur Veeranna"
 *                   role:
 *                     type: string
 *                     example: "FE Dev"
 *                   task_name:
 *                     type: string
 *                     example: "UI Design"
 *                   units_assigned:
 *                     type: integer
 *                     example: 3
 *                   effort_days:
 *                     type: number
 *                     format: decimal
 *                     example: 5.00
 *                   effort_hrs:
 *                     type: number
 *                     format: decimal
 *                     example: 40.00
 *                   buffer_days:
 *                     type: number
 *                     format: decimal
 *                     example: 1.00
 *                   buffer_hrs:
 *                     type: number
 *                     format: decimal
 *                     example: 8.00
 *                   total_hrs:
 *                     type: number
 *                     format: decimal
 *                     example: 48.00
 *                   units:
 *                     type: number
 *                     format: decimal
 *                     example: 10.00
 *                   unit_label:
 *                     type: string
 *                     example: "Story Points"
 *             example:
 *               - id: 1
 *                 project_id: 61
 *                 project_name: "Ariba"
 *                 user_id: 123
 *                 emp_id: "AS02288"
 *                 user_name: "Bedasur Veeranna"
 *                 role: "FE Dev"
 *                 task_name: "UI Design"
 *                 units_assigned: 3
 *                 effort_days: 5.00
 *                 effort_hrs: 40.00
 *                 buffer_days: 1.00
 *                 buffer_hrs: 8.00
 *                 total_hrs: 48.00
 *                 units: 10.00
 *                 unit_label: "Story Points"
 *               - id: 2
 *                 project_id: 61
 *                 project_name: "Ariba"
 *                 user_id: 124
 *                 emp_id: "AS02289"
 *                 user_name: "John Doe"
 *                 role: "BE Dev"
 *                 task_name: "API Development"
 *                 units_assigned: 2
 *                 effort_days: 4.00
 *                 effort_hrs: 32.00
 *                 buffer_days: 0.50
 *                 buffer_hrs: 4.00
 *                 total_hrs: 36.00
 *                 units: 8.00
 *                 unit_label: "Story Points"
 *
 *       400:
 *         description: Bad Request - Missing projectId
 *         content:
 *           application/json:
 *             example:
 *               message: "projectId required"
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */

/**
 * @swagger
 * /assignments/employee-assignments:
 *   get:
 *     summary: Get Employee Assignments
 *     description: |
 *       Retrieves all assignments for a specific employee with progress tracking.
 *       
 *       ### Key Features:
 *       - Returns all tasks assigned to an employee
 *       - Includes progress tracking (completed, pending)
 *       - Shows completion percentage per task
 *       - Calculates hours (estimated, completed, pending)
 *       - Groups tasks by project
 *       - Categorizes tasks by status (not_started, in_progress)
 *       - Provides overall summary
 *       
 *       ### Data Points:
 *       - Employee details: emp_id, name, email, status
 *       - Project-level: project name, hours breakdown
 *       - Task-level: task name, role, status, units, hours, completion %
 *       - Summary: total tasks, not started, in progress, hours
 *       
 *       ### Status Logic:
 *       - not_started: 0 units completed, >0 units pending
 *       - in_progress: >0 units completed, >0 units pending
 *       - completed: 0 units pending (filtered out)
 *       
 *       ### Use Cases:
 *       - Employee workload dashboard
 *       - Track employee progress across projects
 *       - Identify tasks in progress vs not started
 *       - Calculate employee utilization
 *
 *     tags: [Assignments]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: emp_id
 *         required: true
 *         schema:
 *           type: string
 *         description: Employee ID
 *         example: "AS02288"
 *
 *     responses:
 *       200:
 *         description: Employee assignments retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     employee:
 *                       type: object
 *                       properties:
 *                         u_id:
 *                           type: string
 *                         emp_id:
 *                           type: string
 *                         emp_name:
 *                           type: string
 *                         emp_email:
 *                           type: string
 *                         status:
 *                           type: string
 *                     summary:
 *                       type: object
 *                       properties:
 *                         total_tasks:
 *                           type: integer
 *                         total_not_started:
 *                           type: integer
 *                         total_in_progress:
 *                           type: integer
 *                         total_assigned_hours:
 *                           type: number
 *                         total_completed_hours:
 *                           type: number
 *                         total_pending_hours:
 *                           type: number
 *                         overall_completion_percentage:
 *                           type: integer
 *                     tasks:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           project_id:
 *                             type: integer
 *                           project_name:
 *                             type: string
 *                           total_assigned_hours:
 *                             type: number
 *                           total_completed_hours:
 *                             type: number
 *                           total_pending_hours:
 *                             type: number
 *                           tasks:
 *                             type: array
 *                             items:
 *                               type: object
 *                               properties:
 *                                 task_id:
 *                                   type: integer
 *                                 task_name:
 *                                   type: string
 *                                 role:
 *                                   type: string
 *                                 status:
 *                                   type: string
 *                                   enum: [not_started, in_progress]
 *                                 units_assigned:
 *                                   type: integer
 *                                 units_completed:
 *                                   type: number
 *                                 units_pending:
 *                                   type: number
 *                                 estimated_hours:
 *                                   type: number
 *                                 completed_hours:
 *                                   type: number
 *                                 pending_hours:
 *                                   type: number
 *                                 completion_percentage:
 *                                   type: integer
 *             example:
 *               success: true
 *               data:
 *                 employee:
 *                   u_id: "123"
 *                   emp_id: "AS02288"
 *                   emp_name: "Bedasur Veeranna"
 *                   emp_email: "veeranna.b@company.com"
 *                   status: "Active"
 *                 summary:
 *                   total_tasks: 5
 *                   total_not_started: 2
 *                   total_in_progress: 3
 *                   total_assigned_hours: 160.0
 *                   total_completed_hours: 72.0
 *                   total_pending_hours: 88.0
 *                   overall_completion_percentage: 45
 *                 tasks:
 *                   - project_id: 61
 *                     project_name: "Ariba"
 *                     total_assigned_hours: 80.0
 *                     total_completed_hours: 40.0
 *                     total_pending_hours: 40.0
 *                     tasks:
 *                       - task_id: 1
 *                         task_name: "UI Design"
 *                         role: "FE Dev"
 *                         status: "in_progress"
 *                         units_assigned: 3
 *                         units_completed: 2.0
 *                         units_pending: 1.0
 *                         estimated_hours: 24.0
 *                         completed_hours: 16.0
 *                         pending_hours: 8.0
 *                         completion_percentage: 67
 *
 *       400:
 *         description: Bad Request - Missing emp_id
 *         content:
 *           application/json:
 *             example:
 *               success: false
 *               message: "emp_id is required"
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       404:
 *         description: Employee not found
 *         content:
 *           application/json:
 *             example:
 *               success: false
 *               message: "Employee not found"
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */

/**
 * @swagger
 * /assignments:
 *   post:
 *     summary: Create Assignment
 *     description: |
 *       Creates a new assignment for an employee on a specific project task.
 *       
 *       ### Validation Rules:
 *       1. **Task Load Validation**: Cannot assign without existing task load
 *       2. **Capacity Validation**: Cannot exceed planned units/days/hours
 *       3. **Employee Validation**: Employee must exist in master.emp with Active status
 *       4. **Duplicate Assignment**: Multiple assignments allowed for same employee with different role/task combinations
 *       
 *       ### Assignment Limits:
 *       - Total assigned units cannot exceed planned_units
 *       - Total assigned days cannot exceed estimated_days
 *       - Total assigned hours cannot exceed estimated_hours
 *       
 *       ### Employee Resolution (in order):
 *       1. Match by emp_id in master.emp
 *       2. Match by email in local users table
 *       3. Match by cleaned name in local users table
 *       4. Auto-heal: Update emp_id if matched by email or name
 *       
 *       ### Notifications:
 *       - Creates notification for the assigned employee
 *       - Notification includes: assignment details, units, days, hours
 *       
 *       ### Use Cases:
 *       - Assign an employee to a task
 *       - Split task work among multiple employees
 *       - Reassign work between employees
 *
 *     tags: [Assignments]
 *     security:
 *       - bearerAuth: []
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
 *             properties:
 *               project_id:
 *                 type: integer
 *                 description: Project ID
 *                 example: 61
 *               emp_id:
 *                 type: string
 *                 description: Employee ID (from master.emp)
 *                 example: "AS02288"
 *               role:
 *                 type: string
 *                 description: Role name
 *                 example: "FE Dev"
 *               task_name:
 *                 type: string
 *                 description: Task name
 *                 example: "UI Design"
 *               units_assigned:
 *                 type: integer
 *                 description: Number of units assigned to this employee
 *                 example: 3
 *               estimated_days:
 *                 type: number
 *                 format: decimal
 *                 description: Estimated days for this assignment
 *                 example: 1.50
 *               estimated_hours:
 *                 type: number
 *                 format: decimal
 *                 description: Estimated hours for this assignment
 *                 example: 12.00
 *           examples:
 *             basicAssignment:
 *               summary: Basic Assignment
 *               value:
 *                 project_id: 61
 *                 emp_id: "AS02288"
 *                 role: "FE Dev"
 *                 task_name: "UI Design"
 *                 units_assigned: 3
 *             detailedAssignment:
 *               summary: Assignment with Estimates
 *               value:
 *                 project_id: 61
 *                 emp_id: "AS02288"
 *                 role: "FE Dev"
 *                 task_name: "UI Design"
 *                 units_assigned: 3
 *                 estimated_days: 1.50
 *                 estimated_hours: 12.00
 *
 *     responses:
 *       201:
 *         description: Assignment created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "Assignment created successfully"
 *                 data:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: integer
 *                     project_id:
 *                       type: integer
 *                     project_name:
 *                       type: string
 *                     user_id:
 *                       type: integer
 *                     emp_id:
 *                       type: string
 *                     user_name:
 *                       type: string
 *                     role:
 *                       type: string
 *                     task_name:
 *                       type: string
 *                     units_assigned:
 *                       type: integer
 *                     estimated_days:
 *                       type: number
 *                     estimated_hours:
 *                       type: number
 *                     effort_days:
 *                       type: number
 *                     effort_hrs:
 *                       type: number
 *                 remaining:
 *                   type: object
 *                   properties:
 *                     units:
 *                       type: integer
 *                     days:
 *                       type: number
 *                     hours:
 *                       type: number
 *             example:
 *               success: true
 *               message: "Assignment created successfully"
 *               data:
 *                 id: 1
 *                 project_id: 61
 *                 project_name: "Ariba"
 *                 user_id: 123
 *                 emp_id: "AS02288"
 *                 user_name: "Bedasur Veeranna"
 *                 role: "FE Dev"
 *                 task_name: "UI Design"
 *                 units_assigned: 3
 *                 estimated_days: 1.50
 *                 estimated_hours: 12.00
 *                 effort_days: 5.00
 *                 effort_hrs: 40.00
 *               remaining:
 *                 units: 7
 *                 days: 3.50
 *                 hours: 28.00
 *
 *       400:
 *         description: Bad Request - Validation failed
 *         content:
 *           application/json:
 *             examples:
 *               missingFields:
 *                 value:
 *                   message: "project_id, role, task_name required"
 *               noTaskLoad:
 *                 value:
 *                   message: "No task load found for FE Dev - UI Design. Please define task load first."
 *               exceedsLimits:
 *                 value:
 *                   success: false
 *                   message: "Assignment would exceed task limits"
 *                   errors:
 *                     - field: "units"
 *                       message: "Cannot assign 3 units. Total would exceed planned units (10). Remaining: 7"
 *                       planned: 10
 *                       assigned: 7
 *                       requested: 3
 *                       remaining: 7
 *                     - field: "hours"
 *                       message: "Cannot assign 12 hours. Total would exceed planned hours (40). Remaining: 28"
 *               employeeNotFound:
 *                 value:
 *                   message: "Employee not found in master.emp"
 *
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         description: Forbidden
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */

/**
 * @swagger
 * /assignments/{id}:
 *   put:
 *     summary: Update Assignment
 *     description: |
 *       Updates assignment details. Only units_assigned, estimated_days, and estimated_hours can be updated.
 *       
 *       ### Validation Rules:
 *       1. **Cannot update once work has started**:
 *          - Any units completed → blocked
 *          - Any approved progress entries → blocked
 *          - Any rejected progress entries → blocked
 *          - Any task data recorded → blocked
 *       2. **Project Status Check**: Cannot update if project is not in 'Not started' status
 *       3. **Capacity Validation**: Cannot exceed planned limits
 *       4. **Completed Units Handling**: Deducts completed units when checking capacity
 *       
 *       ### Update Restrictions:
 *       - Only these 3 fields can be updated:
 *         - units_assigned
 *         - estimated_days
 *         - estimated_hours
 *       - All other fields (role, task_name, emp_id) cannot be changed
 *       
 *       ### Use Cases:
 *       - Adjust assignment units before work starts
 *       - Correct estimation errors
 *       - Reassign workload between team members (before work starts)
 *
 *     tags: [Assignments]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Assignment ID
 *         example: 1
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               units_assigned:
 *                 type: integer
 *                 description: Updated units assigned
 *                 example: 2
 *               estimated_days:
 *                 type: number
 *                 format: decimal
 *                 description: Updated estimated days
 *                 example: 1.00
 *               estimated_hours:
 *                 type: number
 *                 format: decimal
 *                 description: Updated estimated hours
 *                 example: 8.00
 *           example:
 *             units_assigned: 2
 *             estimated_days: 1.00
 *             estimated_hours: 8.00
 *
 *     responses:
 *       200:
 *         description: Assignment updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "Assignment updated successfully"
 *                 data:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: integer
 *                     project_id:
 *                       type: integer
 *                     project_name:
 *                       type: string
 *                     user_id:
 *                       type: integer
 *                     emp_id:
 *                       type: string
 *                     user_name:
 *                       type: string
 *                     role:
 *                       type: string
 *                     task_name:
 *                       type: string
 *                     units_assigned:
 *                       type: integer
 *                     estimated_days:
 *                       type: number
 *                     estimated_hours:
 *                       type: number
 *                     project_status:
 *                       type: string
 *                 remaining:
 *                   type: object
 *                   properties:
 *                     units:
 *                       type: integer
 *                     days:
 *                       type: number
 *                     hours:
 *                       type: number
 *                 note:
 *                   type: string
 *                   example: "Only units_assigned, estimated_days, and estimated_hours can be updated"
 *             example:
 *               success: true
 *               message: "Assignment updated successfully"
 *               data:
 *                 id: 1
 *                 project_id: 61
 *                 project_name: "Ariba"
 *                 user_id: 123
 *                 emp_id: "AS02288"
 *                 user_name: "Bedasur Veeranna"
 *                 role: "FE Dev"
 *                 task_name: "UI Design"
 *                 units_assigned: 2
 *                 estimated_days: 1.00
 *                 estimated_hours: 8.00
 *                 project_status: "Not started"
 *               remaining:
 *                 units: 8
 *                 days: 4.00
 *                 hours: 32.00
 *               note: "Only units_assigned, estimated_days, and estimated_hours can be updated"
 *
 *       400:
 *         description: Bad Request - Validation failed
 *         content:
 *           application/json:
 *             examples:
 *               noUpdateFields:
 *                 value:
 *                   success: false
 *                   message: "At least one of units_assigned, estimated_days, or estimated_hours must be provided"
 *               exceedsLimits:
 *                 value:
 *                   success: false
 *                   message: "Update would exceed task limits"
 *                   errors:
 *                     - field: "units"
 *                       message: "Cannot assign 2 units. Total would exceed planned units (10). Already completed: 6, Remaining: 4"
 *                       planned: 10
 *                       assigned: 8
 *                       completed: 6
 *                       requested: 2
 *                       remaining: 4
 *
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         description: Forbidden - Work has already started
 *         content:
 *           application/json:
 *             example:
 *               success: false
 *               message: "Cannot update assignment. Work has already started on this task"
 *               details:
 *                 reason: "Work has started with 6 units already completed"
 *                 total_units_completed: 6
 *                 total_progress_entries: 3
 *                 latest_status: "APPROVED"
 *                 has_approved: true
 *                 has_rejected: false
 *                 assignment_id: 1
 *                 task_name: "UI Design"
 *                 role: "FE Dev"
 *
 *       404:
 *         description: Assignment not found
 *         content:
 *           application/json:
 *             example:
 *               success: false
 *               message: "Assignment not found"
 *
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */

/**
 * @swagger
 * /assignments/{id}:
 *   delete:
 *     summary: Delete Assignment
 *     description: |
 *       Deletes an assignment from the system.
 *       
 *       ### Key Features:
 *       - Soft delete from assignments table
 *       - Removes employee-task mapping
 *       
 *       ### Important Notes:
 *       - This is a hard delete (records removed from database)
 *       - Consider backing up before deletion
 *       - Check if work has started before deletion
 *       
 *       ### Use Cases:
 *       - Remove incorrect assignments
 *       - Reassign work to different employees
 *       - Clean up unused assignments
 *
 *     tags: [Assignments]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Assignment ID
 *         example: 1
 *
 *     responses:
 *       200:
 *         description: Assignment deleted successfully
 *         content:
 *           application/json:
 *             example:
 *               message: "Deleted"
 *
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       404:
 *         description: Assignment not found
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
