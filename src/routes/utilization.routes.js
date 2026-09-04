const express = require('express');
const router  = express.Router();

const { authMiddleware, adminOnly } = require('../middleware/auth.middleware');
const {
  getMyAssignments,
  logProgress,
  getPendingApprovals,
  approveProgress,
  rejectProgress,
  getOverallUtilization,
  getProjectUtilization,
  getProjectHealth,
  getProjectUnitSummary,
  getEmployeeUnitSummary,
  exportEmployeeProjectUnit,
  exportEmployeeOverallUnit,
} = require('../controller/utilization.controller');

// ── Employee routes ────────────────────────────────────────────────────────
router.get ('/my-assignments',         authMiddleware, getMyAssignments);
router.post('/log-progress',           authMiddleware, logProgress);

// ── Admin approval routes ──────────────────────────────────────────────────
router.get ('/pending-approvals',      authMiddleware, getPendingApprovals);
router.put ('/approve/:progressId',    authMiddleware, approveProgress);
router.put ('/reject/:progressId',     authMiddleware, rejectProgress);

// ── Admin analytics routes ─────────────────────────────────────────────────
router.get ('/overall',                authMiddleware, getOverallUtilization);
router.get ('/by-project',             authMiddleware, getProjectUtilization);
router.get ('/project-health',         authMiddleware, getProjectHealth);

// ── Unit Utilization routes ──────────────────────────────────────────────────────────────────
router.get ('/project-unit-summary',   authMiddleware, getProjectUnitSummary);
router.get ('/employee-unit-summary',  authMiddleware, getEmployeeUnitSummary);

// ── Unit Utilization Excel Export routes ──────────────────────────────────────────────────────
router.get ('/export/employee-project-unit', authMiddleware, exportEmployeeProjectUnit);
router.get ('/export/employee-overall-unit', authMiddleware, exportEmployeeOverallUnit);

module.exports = router;

/**
 * @swagger
 * tags:
 *   - name: Utilization
 *     description: Resource utilization and progress tracking APIs - Log progress, approve/reject, view utilization metrics
 */

/**
 * @swagger
 * /utilization/my-assignments:
 *   get:
 *     summary: Get My Assignments
 *     description: |
 *       Retrieves all assignments for the authenticated employee with progress tracking.
 *       
 *       ### Key Features:
 *       - Returns all assignments assigned to the employee
 *       - Shows completed units (APPROVED only)
 *       - Shows pending units (remaining work)
 *       - Shows units awaiting approval (PENDING status)
 *       - Calculates completion status per task
 *       
 *       ### Status Breakdown:
 *       - **units_completed**: Units with APPROVED progress
 *       - **units_pending**: Assigned units not yet completed
 *       - **units_awaiting**: Units logged but pending approval
 *       
 *       ### Use Cases:
 *       - Employee dashboard - view assigned tasks
 *       - Track personal progress
 *       - Identify pending work
 *       - Submit progress updates
 *
 *     tags: [Utilization]
 *     security:
 *       - bearerAuth: []
 *     
 *     parameters:
 *       - in: query
 *         name: userId
 *         schema:
 *           type: string
 *         description: User ID or emp_id (optional, defaults to authenticated user)
 *         example: "AS02288"
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
 *                   assignment_id:
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
 *                   units_assigned:
 *                     type: integer
 *                     example: 10
 *                   units_completed:
 *                     type: number
 *                     format: decimal
 *                     example: 6.0
 *                   units_pending:
 *                     type: number
 *                     format: decimal
 *                     example: 4.0
 *                   units_awaiting:
 *                     type: number
 *                     format: decimal
 *                     example: 2.0
 *             example:
 *               - assignment_id: 1
 *                 project_id: 61
 *                 project_name: "Ariba"
 *                 role: "FE Dev"
 *                 task_name: "UI Design"
 *                 units_assigned: 10
 *                 units_completed: 6.0
 *                 units_pending: 4.0
 *                 units_awaiting: 2.0
 *               - assignment_id: 2
 *                 project_id: 61
 *                 project_name: "Ariba"
 *                 role: "BE Dev"
 *                 task_name: "API Development"
 *                 units_assigned: 8
 *                 units_completed: 5.0
 *                 units_pending: 3.0
 *                 units_awaiting: 0.0
 *       
 *       400:
 *         description: Bad Request - Employee not found
 *         content:
 *           application/json:
 *             example:
 *               message: "Employee not found. Please login again."
 *       
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */

/**
 * @swagger
 * /utilization/log-progress:
 *   post:
 *     summary: Log Progress on Assignment
 *     description: |
 *       Logs daily progress on an assignment. Progress is auto-approved for immediate reflection.
 *       
 *       ### Key Features:
 *       - Log units completed for the day
 *       - Record today's tasks and tomorrow's plan
 *       - Track risks and issues
 *       - Auto-approval for immediate visibility
 *       - Prevents exceeding assigned units
 *       - Supports manual tasks without assignment_id
 *       
 *       ### Required Fields:
 *       - **date**: Date of progress (YYYY-MM-DD)
 *       - **todays_tasks**: Work done today
 *       - **total_time_needed**: Estimated time needed
 *       
 *       ### Either Provide:
 *       - **assignment_id**: For assigned tasks
 *       - OR (for manual tasks):
 *         - **project_id**, **role**, **task_name**
 *       
 *       ### Validation:
 *       - Cannot exceed total assigned units
 *       - Must belong to the employee
 *       
 *       ### Use Cases:
 *       - Daily standup updates
 *       - Timesheet entry
 *       - Progress tracking
 *       - Work log
 *
 *     tags: [Utilization]
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
 *               - date
 *               - todays_tasks
 *               - total_time_needed
 *             properties:
 *               assignment_id:
 *                 type: integer
 *                 description: Assignment ID (required for assigned tasks)
 *                 example: 1
 *               user_id:
 *                 type: string
 *                 description: User ID or emp_id (optional, resolved from token)
 *                 example: "AS02288"
 *               date:
 *                 type: string
 *                 format: date
 *                 description: Progress date (YYYY-MM-DD)
 *                 example: "2026-07-23"
 *               units_completed:
 *                 type: integer
 *                 description: Units completed today
 *                 example: 2
 *               todays_tasks:
 *                 type: string
 *                 description: Work done today
 *                 example: "Implemented login page, dashboard layout, navigation"
 *               total_time_needed:
 *                 type: string
 *                 description: Estimated time needed
 *                 example: "8 hours"
 *               yesterdays_tasks:
 *                 type: string
 *                 description: Work done yesterday (for reference)
 *                 example: "Created wireframes"
 *               risks:
 *                 type: string
 *                 description: Risks or blockers
 *                 example: "API delay from backend team"
 *               project_id:
 *                 type: integer
 *                 description: Project ID (required for manual tasks)
 *                 example: 61
 *               role:
 *                 type: string
 *                 description: Role (required for manual tasks)
 *                 example: "FE Dev"
 *               task_name:
 *                 type: string
 *                 description: Task name (required for manual tasks)
 *                 example: "UI Design"
 *               remarks:
 *                 type: string
 *                 description: Additional remarks
 *                 example: "On track for delivery"
 *               availability:
 *                 type: string
 *                 description: Availability status
 *                 example: "Available"
 *           examples:
 *             assignedTask:
 *               summary: Log Progress on Assigned Task
 *               value:
 *                 assignment_id: 1
 *                 date: "2026-07-23"
 *                 units_completed: 2
 *                 todays_tasks: "Implemented login page, dashboard layout"
 *                 total_time_needed: "8 hours"
 *                 yesterdays_tasks: "Created wireframes"
 *                 risks: "None"
 *                 remarks: "On track"
 *                 availability: "Available"
 *             manualTask:
 *               summary: Log Progress on Manual Task
 *               value:
 *                 project_id: 61
 *                 role: "FE Dev"
 *                 task_name: "UI Design"
 *                 date: "2026-07-23"
 *                 units_completed: 3
 *                 todays_tasks: "Implemented responsive design, animations"
 *                 total_time_needed: "6 hours"
 *                 yesterdays_tasks: "Designed mockups"
 *                 risks: "Browser compatibility issues"
 *                 remarks: "Will test on multiple browsers"
 *                 availability: "Available"
 *
 *     responses:
 *       201:
 *         description: Progress logged successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: integer
 *                   example: 1
 *                 status:
 *                   type: string
 *                   example: "APPROVED"
 *                 message:
 *                   type: string
 *                   example: "Progress logged successfully!"
 *             example:
 *               id: 1
 *               status: "APPROVED"
 *               message: "Progress logged successfully!"
 *       
 *       400:
 *         description: Bad Request - Validation failed
 *         content:
 *           application/json:
 *             examples:
 *               missingDate:
 *                 value:
 *                   message: "date is required"
 *               missingTasks:
 *                 value:
 *                   message: "Today's Tasks are required"
 *               missingTimeNeeded:
 *                 value:
 *                   message: "Total Time Needed is required"
 *               exceedsUnits:
 *                 value:
 *                   message: "Cannot log 3 units. Only 2 units remaining."
 *               manualTaskMissingFields:
 *                 value:
 *                   message: "Project is required for manual tasks"
 *               missingRole:
 *                 value:
 *                   message: "Role is required for manual tasks"
 *               missingTaskName:
 *                 value:
 *                   message: "Task Name/Title is required for manual tasks"
 *       
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       
 *       403:
 *         description: Forbidden - Not authorized to log progress for this assignment
 *         content:
 *           application/json:
 *             example:
 *               message: "You are not authorized to log progress for this assignment"
 *       
 *       404:
 *         description: Assignment not found
 *         content:
 *           application/json:
 *             example:
 *               message: "Assignment not found"
 *       
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */

/**
 * @swagger
 * /utilization/pending-approvals:
 *   get:
 *     summary: Get Pending Approvals (Admin Only)
 *     description: |
 *       Retrieves all progress logs pending approval.
 *       
 *       ### Key Features:
 *       - Shows all PENDING progress logs
 *       - Includes employee details from master.emp
 *       - Shows assignment and project details
 *       - Ordered by date (oldest first)
 *       
 *       ### Access Control:
 *       - Admin only
 *       - Used for approval workflow
 *       
 *       ### Use Cases:
 *       - Admin approval dashboard
 *       - Review employee progress
 *       - Quality assurance
 *
 *     tags: [Utilization]
 *     security:
 *       - bearerAuth: []
 *
 *     responses:
 *       200:
 *         description: Pending approvals retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   progress_id:
 *                     type: integer
 *                     example: 1
 *                   assignment_id:
 *                     type: integer
 *                     example: 1
 *                   date:
 *                     type: string
 *                     format: date
 *                     example: "2026-07-23"
 *                   units_completed:
 *                     type: integer
 *                     example: 2
 *                   remarks:
 *                     type: string
 *                     example: "Completed login page"
 *                   status:
 *                     type: string
 *                     example: "PENDING"
 *                   rejection_reason:
 *                     type: string
 *                     nullable: true
 *                     example: null
 *                   user_id:
 *                     type: string
 *                     example: "123"
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
 *                     example: 10
 *                   project_id:
 *                     type: integer
 *                     example: 61
 *                   project_name:
 *                     type: string
 *                     example: "Ariba"
 *             example:
 *               - progress_id: 1
 *                 assignment_id: 1
 *                 date: "2026-07-23"
 *                 units_completed: 2
 *                 remarks: "Completed login page"
 *                 status: "PENDING"
 *                 rejection_reason: null
 *                 user_id: "123"
 *                 user_name: "Bedasur Veeranna"
 *                 role: "FE Dev"
 *                 task_name: "UI Design"
 *                 units_assigned: 10
 *                 project_id: 61
 *                 project_name: "Ariba"
 *       
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */

/**
 * @swagger
 * /utilization/approve/{progressId}:
 *   put:
 *     summary: Approve Progress Log (Admin Only)
 *     description: |
 *       Approves a pending progress log.
 *       
 *       ### Key Features:
 *       - Changes status from PENDING to APPROVED
 *       - Sends notification to the employee
 *       - Updates completion metrics
 *       
 *       ### Validation:
 *       - Progress log must exist
 *       - Status must be PENDING
 *       
 *       ### Use Cases:
 *       - Approve employee progress
 *       - Quality assurance
 *       - Milestone verification
 *
 *     tags: [Utilization]
 *     security:
 *       - bearerAuth: []
 *     
 *     parameters:
 *       - in: path
 *         name: progressId
 *         required: true
 *         schema:
 *           type: integer
 *         description: Progress log ID
 *         example: 1
 *
 *     responses:
 *       200:
 *         description: Progress approved successfully
 *         content:
 *           application/json:
 *             example:
 *               message: "Approved"
 *       
 *       400:
 *         description: Bad Request - Cannot approve
 *         content:
 *           application/json:
 *             example:
 *               message: "Cannot approve — current status is REJECTED"
 *       
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       
 *       404:
 *         description: Progress log not found
 *         content:
 *           application/json:
 *             example:
 *               message: "Progress log not found"
 *       
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */

/**
 * @swagger
 * /utilization/reject/{progressId}:
 *   put:
 *     summary: Reject Progress Log (Admin Only)
 *     description: |
 *       Rejects a pending progress log with reason.
 *       
 *       ### Key Features:
 *       - Changes status from PENDING to REJECTED
 *       - Stores rejection reason
 *       - Sends notification to the employee
 *       
 *       ### Validation:
 *       - Progress log must exist
 *       - Status must be PENDING
 *       
 *       ### Use Cases:
 *       - Reject incorrect progress
 *       - Quality assurance
 *       - Provide feedback to employee
 *
 *     tags: [Utilization]
 *     security:
 *       - bearerAuth: []
 *     
 *     parameters:
 *       - in: path
 *         name: progressId
 *         required: true
 *         schema:
 *           type: integer
 *         description: Progress log ID
 *         example: 1
 *     
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               reason:
 *                 type: string
 *                 description: Rejection reason
 *                 example: "Units logged exceed assigned units"
 *           example:
 *             reason: "Units logged exceed assigned units"
 *
 *     responses:
 *       200:
 *         description: Progress rejected successfully
 *         content:
 *           application/json:
 *             example:
 *               message: "Rejected"
 *       
 *       400:
 *         description: Bad Request - Cannot reject
 *         content:
 *           application/json:
 *             example:
 *               message: "Cannot reject — current status is APPROVED"
 *       
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       
 *       404:
 *         description: Progress log not found
 *         content:
 *           application/json:
 *             example:
 *               message: "Progress log not found"
 *       
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */

/**
 * @swagger
 * /utilization/overall:
 *   get:
 *     summary: Get Overall Utilization (Admin Only)
 *     description: |
 *       Retrieves overall utilization for all active employees.
 *       
 *       ### Key Features:
 *       - Shows all active employees from master.emp
 *       - Calculates total assigned units
 *       - Shows completed and pending units
 *       - Calculates utilization percentage
 *       - Sorted by utilization (highest first)
 *       
 *       ### Calculations:
 *       - **utilization_pct** = (completed / assigned) × 100
 *       - **total_pending** = assigned - completed
 *       - Only APPROVED progress counts
 *       
 *       ### Use Cases:
 *       - Management dashboard
 *       - Resource utilization tracking
 *       - Capacity planning
 *       - Performance monitoring
 *
 *     tags: [Utilization]
 *     security:
 *       - bearerAuth: []
 *
 *     responses:
 *       200:
 *         description: Overall utilization retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   user_id:
 *                     type: string
 *                     example: "123"
 *                   user_name:
 *                     type: string
 *                     example: "Bedasur Veeranna"
 *                   user_role:
 *                     type: string
 *                     example: "EMP"
 *                   daily_capacity:
 *                     type: integer
 *                     example: 8
 *                   total_assigned:
 *                     type: number
 *                     format: decimal
 *                     example: 10.0
 *                   total_completed:
 *                     type: number
 *                     format: decimal
 *                     example: 6.5
 *                   total_pending:
 *                     type: number
 *                     format: decimal
 *                     example: 3.5
 *                   utilization_pct:
 *                     type: number
 *                     format: decimal
 *                     example: 65.0
 *             example:
 *               - user_id: "123"
 *                 user_name: "Bedasur Veeranna"
 *                 user_role: "EMP"
 *                 daily_capacity: 8
 *                 total_assigned: 10.0
 *                 total_completed: 6.5
 *                 total_pending: 3.5
 *                 utilization_pct: 65.0
 *               - user_id: "124"
 *                 user_name: "John Doe"
 *                 user_role: "EMP"
 *                 daily_capacity: 8
 *                 total_assigned: 8.0
 *                 total_completed: 7.0
 *                 total_pending: 1.0
 *                 utilization_pct: 87.5
 *       
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */

/**
 * @swagger
 * /utilization/by-project:
 *   get:
 *     summary: Get Project-wise Utilization (Admin Only)
 *     description: |
 *       Retrieves utilization details by project with employee breakdown.
 *       
 *       ### Key Features:
 *       - Shows all assignments per project
 *       - Includes employee details
 *       - Shows assigned, completed, pending units
 *       - Calculates completion percentage
 *       - Shows hours utilized
 *       
 *       ### Fields:
 *       - **units_assigned**: Total units assigned
 *       - **units_completed**: Approved units completed
 *       - **units_pending**: Remaining units
 *       - **hours_assigned**: Estimated hours
 *       - **hours_utilized**: Actual hours logged
 *       - **hours_pending**: Remaining hours
 *       - **completion_pct**: Percentage complete
 *       
 *       ### Use Cases:
 *       - Project progress tracking
 *       - Resource allocation per project
 *       - Identify over/under utilization
 *
 *     tags: [Utilization]
 *     security:
 *       - bearerAuth: []
 *     
 *     parameters:
 *       - in: query
 *         name: projectId
 *         schema:
 *           type: integer
 *         description: Filter by project ID (optional)
 *         example: 61
 *
 *     responses:
 *       200:
 *         description: Project utilization retrieved successfully
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
 *                   project_name:
 *                     type: string
 *                     example: "Ariba"
 *                   user_id:
 *                     type: string
 *                     example: "123"
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
 *                     example: 10
 *                   hours_assigned:
 *                     type: number
 *                     format: decimal
 *                     example: 80.0
 *                   units_completed:
 *                     type: number
 *                     format: decimal
 *                     example: 6.0
 *                   units_pending:
 *                     type: number
 *                     format: decimal
 *                     example: 4.0
 *                   hours_utilized:
 *                     type: number
 *                     format: decimal
 *                     example: 48.0
 *                   hours_pending:
 *                     type: number
 *                     format: decimal
 *                     example: 32.0
 *                   completion_pct:
 *                     type: number
 *                     format: decimal
 *                     example: 60.0
 *             example:
 *               - project_id: 61
 *                 project_name: "Ariba"
 *                 user_id: "123"
 *                 user_name: "Bedasur Veeranna"
 *                 role: "FE Dev"
 *                 task_name: "UI Design"
 *                 units_assigned: 10
 *                 hours_assigned: 80.0
 *                 units_completed: 6.0
 *                 units_pending: 4.0
 *                 hours_utilized: 48.0
 *                 hours_pending: 32.0
 *                 completion_pct: 60.0
 *       
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */

/**
 * @swagger
 * /utilization/project-health:
 *   get:
 *     summary: Get Project Health Dashboard (Admin Only)
 *     description: |
 *       Retrieves health metrics for all projects.
 *       
 *       ### Key Features:
 *       - Shows project-level summary
 *       - Calculates completion percentage
 *       - Shows unassigned work
 *       - Project status and dates
 *       
 *       ### Metrics:
 *       - **total_load**: Planned units
 *       - **total_assigned**: Assigned units
 *       - **total_completed**: Completed units
 *       - **total_pending**: Assigned but not completed
 *       - **total_unassigned**: Planned but not assigned
 *       - **completion_pct**: Percentage complete
 *       
 *       ### Use Cases:
 *       - Project health dashboard
 *       - Identify struggling projects
 *       - Resource allocation insights
 *       - Status reporting
 *
 *     tags: [Utilization]
 *     security:
 *       - bearerAuth: []
 *
 *     responses:
 *       200:
 *         description: Project health retrieved successfully
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
 *                   project_name:
 *                     type: string
 *                     example: "Ariba"
 *                   status:
 *                     type: string
 *                     example: "In progress"
 *                   start_date:
 *                     type: string
 *                     format: date
 *                     example: "2026-01-01"
 *                   end_date:
 *                     type: string
 *                     format: date
 *                     example: "2026-12-31"
 *                   total_load:
 *                     type: integer
 *                     example: 50
 *                   total_assigned:
 *                     type: integer
 *                     example: 40
 *                   total_completed:
 *                     type: integer
 *                     example: 28
 *                   total_pending:
 *                     type: integer
 *                     example: 12
 *                   total_unassigned:
 *                     type: integer
 *                     example: 10
 *                   completion_pct:
 *                     type: number
 *                     format: decimal
 *                     example: 70.0
 *             example:
 *               - project_id: 61
 *                 project_name: "Ariba"
 *                 status: "In progress"
 *                 start_date: "2026-01-01"
 *                 end_date: "2026-12-31"
 *                 total_load: 50
 *                 total_assigned: 40
 *                 total_completed: 28
 *                 total_pending: 12
 *                 total_unassigned: 10
 *                 completion_pct: 70.0
 *       
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */

/**
 * @swagger
 * /utilization/project-unit-summary:
 *   get:
 *     summary: Get Project Unit Summary
 *     description: |
 *       Retrieves unit-level summary for projects.
 *       
 *       ### Key Features:
 *       - Shows total units per project
 *       - Shows completed and pending units
 *       - Calculates utilization percentage
 *       - Optional project filter
 *       
 *       ### Fields:
 *       - **total_units**: Total units assigned
 *       - **completed_units**: Completed units
 *       - **pending_units**: Pending units
 *       - **utilization_pct**: Percentage utilized
 *       
 *       ### Use Cases:
 *       - Project progress tracking
 *       - Unit-based utilization metrics
 *       - Portfolio management
 *
 *     tags: [Utilization]
 *     security:
 *       - bearerAuth: []
 *     
 *     parameters:
 *       - in: query
 *         name: projectId
 *         schema:
 *           type: integer
 *         description: Filter by project ID (optional)
 *         example: 61
 *
 *     responses:
 *       200:
 *         description: Project unit summary retrieved successfully
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
 *                   project_name:
 *                     type: string
 *                     example: "Ariba"
 *                   project_code:
 *                     type: string
 *                     example: "ARB-001"
 *                   status:
 *                     type: string
 *                     example: "In progress"
 *                   total_units:
 *                     type: integer
 *                     example: 50
 *                   completed_units:
 *                     type: integer
 *                     example: 35
 *                   pending_units:
 *                     type: integer
 *                     example: 15
 *                   utilization_pct:
 *                     type: number
 *                     format: decimal
 *                     example: 70.0
 *             example:
 *               - project_id: 61
 *                 project_name: "Ariba"
 *                 project_code: "ARB-001"
 *                 status: "In progress"
 *                 total_units: 50
 *                 completed_units: 35
 *                 pending_units: 15
 *                 utilization_pct: 70.0
 *       
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */

/**
 * @swagger
 * /utilization/employee-unit-summary:
 *   get:
 *     summary: Get Employee Unit Summary
 *     description: |
 *       Retrieves unit-level summary for an employee.
 *       
 *       ### Key Features:
 *       - Per-project task breakdown
 *       - Project-level summary
 *       - Overall summary across all projects
 *       - Employee details from master.emp
 *       
 *       ### Response Structure:
 *       - **employee**: Employee details
 *       - **task_breakdown**: Detailed task list
 *       - **project_summary**: Per-project summary
 *       - **overall_summary**: Overall metrics
 *       
 *       ### Metrics:
 *       - total_tasks, total_units_assigned
 *       - total_units_completed, total_units_pending
 *       - employee_utilization_pct
 *       
 *       ### Use Cases:
 *       - Employee performance review
 *       - Individual utilization tracking
 *       - Workload analysis
 *       - Resource planning
 *
 *     tags: [Utilization]
 *     security:
 *       - bearerAuth: []
 *     
 *     parameters:
 *       - in: query
 *         name: empId
 *         required: true
 *         schema:
 *           type: string
 *         description: Employee ID
 *         example: "AS02288"
 *       - in: query
 *         name: projectId
 *         schema:
 *           type: integer
 *         description: Filter by project ID (optional)
 *         example: 61
 *
 *     responses:
 *       200:
 *         description: Employee unit summary retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 employee:
 *                   type: object
 *                   properties:
 *                     emp_name:
 *                       type: string
 *                       example: "Bedasur Veeranna"
 *                     emp_id:
 *                       type: string
 *                       example: "AS02288"
 *                 task_breakdown:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       project_id:
 *                         type: integer
 *                       project_name:
 *                         type: string
 *                       assignment_id:
 *                         type: integer
 *                       task_name:
 *                         type: string
 *                       role:
 *                         type: string
 *                       units_assigned:
 *                         type: integer
 *                       units_completed:
 *                         type: number
 *                       units_pending:
 *                         type: number
 *                 project_summary:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       project_id:
 *                         type: integer
 *                       project_name:
 *                         type: string
 *                       total_tasks:
 *                         type: integer
 *                       total_units_assigned:
 *                         type: integer
 *                       total_units_completed:
 *                         type: number
 *                       total_units_pending:
 *                         type: number
 *                       employee_utilization_pct:
 *                         type: number
 *                         format: decimal
 *                 overall_summary:
 *                   type: object
 *                   properties:
 *                     total_projects:
 *                       type: integer
 *                     total_tasks:
 *                       type: integer
 *                     total_units_assigned:
 *                       type: integer
 *                     total_units_completed:
 *                       type: number
 *                     total_units_pending:
 *                       type: number
 *                     overall_utilization_pct:
 *                       type: number
 *                       format: decimal
 *             example:
 *               employee:
 *                 emp_name: "Bedasur Veeranna"
 *                 emp_id: "AS02288"
 *               task_breakdown:
 *                 - project_id: 61
 *                   project_name: "Ariba"
 *                   assignment_id: 1
 *                   task_name: "UI Design"
 *                   role: "FE Dev"
 *                   units_assigned: 10
 *                   units_completed: 6.0
 *                   units_pending: 4.0
 *               project_summary:
 *                 - project_id: 61
 *                   project_name: "Ariba"
 *                   total_tasks: 3
 *                   total_units_assigned: 23
 *                   total_units_completed: 15.0
 *                   total_units_pending: 8.0
 *                   employee_utilization_pct: 65.2
 *               overall_summary:
 *                 total_projects: 10
 *                 total_tasks: 34
 *                 total_units_assigned: 61
 *                 total_units_completed: 29.0
 *                 total_units_pending: 32.0
 *                 overall_utilization_pct: 47.5
 *       
 *       400:
 *         description: Bad Request - Missing empId
 *         content:
 *           application/json:
 *             example:
 *               message: "empId is required"
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
