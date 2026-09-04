const express = require('express');
const router  = express.Router();

const { authMiddleware, adminOnly } = require('../middleware/auth.middleware');
const {
  createProject,
  getAllProjects,
  getEffortEstimate,
  upsertEffortEstimate,
  deleteEffortEstimate,
  updateProject,
  getCustomers,
  fetchPMSProjects,
  fetchPMSProjectDetails
} = require('../controller/project.controller');

// ── Customer List ─────────────────────────────────────────────
router.get('/customers', authMiddleware, getCustomers);

// ── Project CRUD ──────────────────────────────────────────────
router.post('/',  createProject);
router.get('/',   getAllProjects);
router.put('/:id', authMiddleware, updateProject);

// ── Effort Estimate ───────────────────────────────────────────
// GET    /projects/:projectId/effort       — fetch estimate for project
router.get   ('/:projectId/effort', authMiddleware,  getEffortEstimate);

// POST   /projects/:projectId/effort/bulk  — upsert all rows at once
router.post  ('/:projectId/effort/bulk', authMiddleware,  upsertEffortEstimate);

// DELETE /projects/:projectId/effort       — reset / clear estimate
router.delete('/:projectId/effort', authMiddleware,  deleteEffortEstimate);
// API to fetch all projects from PMS for dropdown
router.get('/pms/projects', fetchPMSProjects);
// API to fetch project details from PMS including milestones and tasks
router.get('/pms/project-details', fetchPMSProjectDetails);

module.exports = router;

/**
 * @swagger
 * tags:
 *   - name: Projects
 *     description: Project management APIs - Create, update, view, and manage projects with effort estimates
 */

/**
 * @swagger
 * /projects:
 *   post:
 *     summary: Create New Project
 *     description: |
 *       Creates a new project in the system.
 *       
 *       ### Key Features:
 *       - Create project with basic information
 *       - Auto-generates project ID
 *       - Sets default status to 'New' if not provided
 *       - Supports project type and team lead assignment
 *       
 *       ### Required Fields:
 *       - **name**: Project name
 *       - **clientName**: Client name
 *       
 *       ### Optional Fields:
 *       - **description**: Project description
 *       - **nbdId**: NBD identifier
 *       - **o2dId**: O2D identifier
 *       - **projectCode**: Project code
 *       - **subCategory**: Sub-category
 *       - **startDate**: Start date (YYYY-MM-DD)
 *       - **endDate**: End date (YYYY-MM-DD)
 *       - **status**: Project status (default: 'New')
 *       - **projectType**: Type of project
 *       - **teamLead**: Team lead name
 *       
 *       ### Status Options:
 *       - Not started
 *       - In progress
 *       - Completed
 *       - Abandoned
 *       - CR
 *       - New
 *       - On Hold
 *       - New CR
 *       
 *       ### Use Cases:
 *       - Start new project
 *       - Project intake
 *       - Client project creation
 *
 *     tags: [Projects]
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
 *               - name
 *               - clientName
 *             properties:
 *               name:
 *                 type: string
 *                 description: Project name
 *                 example: "Ariba Implementation"
 *               clientName:
 *                 type: string
 *                 description: Client name
 *                 example: "SAP Ariba"
 *               description:
 *                 type: string
 *                 description: Project description
 *                 example: "Implementation of Ariba procurement platform"
 *               nbdId:
 *                 type: string
 *                 description: NBD identifier
 *                 example: "NBD-2024-001"
 *               o2dId:
 *                 type: string
 *                 description: O2D identifier
 *                 example: "O2D-2024-001"
 *               projectCode:
 *                 type: string
 *                 description: Project code
 *                 example: "ARB-001"
 *               subCategory:
 *                 type: string
 *                 description: Sub-category
 *                 example: "Procurement"
 *               startDate:
 *                 type: string
 *                 format: date
 *                 description: Start date (YYYY-MM-DD)
 *                 example: "2026-01-01"
 *               endDate:
 *                 type: string
 *                 format: date
 *                 description: End date (YYYY-MM-DD)
 *                 example: "2026-12-31"
 *               status:
 *                 type: string
 *                 enum: [Not started, In progress, Completed, Abandoned, CR, New, On Hold, New CR]
 *                 description: Project status
 *                 example: "New"
 *               projectType:
 *                 type: string
 *                 description: Type of project
 *                 example: "Implementation"
 *               teamLead:
 *                 type: string
 *                 description: Team lead name
 *                 example: "John Doe"
 *           examples:
 *             basicProject:
 *               summary: Basic Project
 *               value:
 *                 name: "Ariba Implementation"
 *                 clientName: "SAP Ariba"
 *             fullProject:
 *               summary: Full Project with all fields
 *               value:
 *                 name: "Ariba Implementation"
 *                 clientName: "SAP Ariba"
 *                 description: "Implementation of Ariba procurement platform"
 *                 nbdId: "NBD-2024-001"
 *                 o2dId: "O2D-2024-001"
 *                 projectCode: "ARB-001"
 *                 subCategory: "Procurement"
 *                 startDate: "2026-01-01"
 *                 endDate: "2026-12-31"
 *                 status: "Not started"
 *                 projectType: "Implementation"
 *                 teamLead: "John Doe"
 *
 *     responses:
 *       201:
 *         description: Project created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: integer
 *                   example: 1
 *                 project_name:
 *                   type: string
 *                   example: "Ariba Implementation"
 *                 client_name:
 *                   type: string
 *                   example: "SAP Ariba"
 *                 description:
 *                   type: string
 *                   example: "Implementation of Ariba procurement platform"
 *                 nbd_id:
 *                   type: string
 *                   example: "NBD-2024-001"
 *                 o2d_id:
 *                   type: string
 *                   example: "O2D-2024-001"
 *                 project_code:
 *                   type: string
 *                   example: "ARB-001"
 *                 sub_category:
 *                   type: string
 *                   example: "Procurement"
 *                 start_date:
 *                   type: string
 *                   format: date
 *                   example: "2026-01-01"
 *                 end_date:
 *                   type: string
 *                   format: date
 *                   example: "2026-12-31"
 *                 status:
 *                   type: string
 *                   example: "Not started"
 *                 project_type:
 *                   type: string
 *                   example: "Implementation"
 *                 team_lead:
 *                   type: string
 *                   example: "John Doe"
 *             example:
 *               id: 1
 *               project_name: "Ariba Implementation"
 *               client_name: "SAP Ariba"
 *               description: "Implementation of Ariba procurement platform"
 *               nbd_id: "NBD-2024-001"
 *               o2d_id: "O2D-2024-001"
 *               project_code: "ARB-001"
 *               sub_category: "Procurement"
 *               start_date: "2026-01-01"
 *               end_date: "2026-12-31"
 *               status: "Not started"
 *               project_type: "Implementation"
 *               team_lead: "John Doe"
 *       
 *       400:
 *         description: Bad Request - Missing required fields
 *         content:
 *           application/json:
 *             example:
 *               message: "Project name and client name are required"
 *       
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */

/**
 * @swagger
 * /projects:
 *   get:
 *     summary: Get All Projects
 *     description: |
 *       Retrieves all projects with their effort estimates.
 *       
 *       ### Key Features:
 *       - Returns all projects ordered by ID ASC
 *       - Includes total effort hours and days per project
 *       - Shows all project details including status and team lead
 *       
 *       ### Calculated Fields:
 *       - **total_effort_hours**: Sum of total_hrs from effort_estimates
 *       - **total_effort_days**: Sum of effort_days + buffer_days
 *       
 *       ### Use Cases:
 *       - Project dashboard
 *       - Portfolio management
 *       - Resource planning
 *       - Status reporting
 *
 *     tags: [Projects]
 *     security:
 *       - bearerAuth: []
 *     
 *     responses:
 *       200:
 *         description: Projects retrieved successfully
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
 *                   project_name:
 *                     type: string
 *                     example: "Ariba Implementation"
 *                   client_name:
 *                     type: string
 *                     example: "SAP Ariba"
 *                   description:
 *                     type: string
 *                     example: "Implementation of Ariba procurement platform"
 *                   nbd_id:
 *                     type: string
 *                     example: "NBD-2024-001"
 *                   o2d_id:
 *                     type: string
 *                     example: "O2D-2024-001"
 *                   project_code:
 *                     type: string
 *                     example: "ARB-001"
 *                   sub_category:
 *                     type: string
 *                     example: "Procurement"
 *                   start_date:
 *                     type: string
 *                     format: date
 *                     example: "2026-01-01"
 *                   end_date:
 *                     type: string
 *                     format: date
 *                     example: "2026-12-31"
 *                   status:
 *                     type: string
 *                     enum: [Not started, In progress, Completed, Abandoned, CR, New, On Hold, New CR]
 *                     example: "In progress"
 *                   project_type:
 *                     type: string
 *                     example: "Implementation"
 *                   team_lead:
 *                     type: string
 *                     example: "John Doe"
 *                   create_cr:
 *                     type: string
 *                     nullable: true
 *                     example: null
 *                   total_effort_hours:
 *                     type: number
 *                     format: decimal
 *                     example: 320.00
 *                   total_effort_days:
 *                     type: number
 *                     format: decimal
 *                     example: 40.00
 *             example:
 *               - id: 1
 *                 project_name: "Ariba Implementation"
 *                 client_name: "SAP Ariba"
 *                 description: "Implementation of Ariba procurement platform"
 *                 nbd_id: "NBD-2024-001"
 *                 o2d_id: "O2D-2024-001"
 *                 project_code: "ARB-001"
 *                 sub_category: "Procurement"
 *                 start_date: "2026-01-01"
 *                 end_date: "2026-12-31"
 *                 status: "In progress"
 *                 project_type: "Implementation"
 *                 team_lead: "John Doe"
 *                 create_cr: null
 *                 total_effort_hours: 320.00
 *                 total_effort_days: 40.00
 *               - id: 2
 *                 project_name: "CRM Implementation"
 *                 client_name: "Salesforce"
 *                 description: "Salesforce CRM implementation"
 *                 nbd_id: "NBD-2024-002"
 *                 o2d_id: "O2D-2024-002"
 *                 project_code: "CRM-001"
 *                 sub_category: "CRM"
 *                 start_date: "2026-02-01"
 *                 end_date: "2026-08-31"
 *                 status: "Not started"
 *                 project_type: "Implementation"
 *                 team_lead: "Jane Smith"
 *                 create_cr: null
 *                 total_effort_hours: 240.00
 *                 total_effort_days: 30.00
 *       
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */

/**
 * @swagger
 * /projects/{id}:
 *   put:
 *     summary: Update Project
 *     description: |
 *       Updates an existing project. All fields are optional.
 *       
 *       ### Key Features:
 *       - Partial updates (only send fields to update)
 *       - Cannot update ID (primary key)
 *       - Preserves unchanged fields
 *       - Validates project existence
 *       
 *       ### Update Rules:
 *       - All fields are optional
 *       - Only provided fields are updated
 *       - Status must be valid enum value
 *       - Dates must be in YYYY-MM-DD format
 *       
 *       ### Use Cases:
 *       - Update project status
 *       - Change project dates
 *       - Update team lead
 *       - Modify project details
 *
 *     tags: [Projects]
 *     security:
 *       - bearerAuth: []
 *     
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Project ID
 *         example: 1
 *     
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *                 description: Project name
 *                 example: "Ariba Implementation - Phase 2"
 *               clientName:
 *                 type: string
 *                 description: Client name
 *                 example: "SAP Ariba"
 *               description:
 *                 type: string
 *                 description: Project description
 *                 example: "Phase 2 implementation of Ariba procurement platform"
 *               nbdId:
 *                 type: string
 *                 description: NBD identifier
 *                 example: "NBD-2024-001"
 *               o2dId:
 *                 type: string
 *                 description: O2D identifier
 *                 example: "O2D-2024-001"
 *               projectCode:
 *                 type: string
 *                 description: Project code
 *                 example: "ARB-001"
 *               subCategory:
 *                 type: string
 *                 description: Sub-category
 *                 example: "Procurement"
 *               startDate:
 *                 type: string
 *                 format: date
 *                 description: Start date (YYYY-MM-DD)
 *                 example: "2026-01-01"
 *               endDate:
 *                 type: string
 *                 format: date
 *                 description: End date (YYYY-MM-DD)
 *                 example: "2026-12-31"
 *               status:
 *                 type: string
 *                 enum: [Not started, In progress, Completed, Abandoned, CR, New, On Hold, New CR]
 *                 description: Project status
 *                 example: "In progress"
 *               projectType:
 *                 type: string
 *                 description: Type of project
 *                 example: "Implementation"
 *               teamLead:
 *                 type: string
 *                 description: Team lead name
 *                 example: "John Doe"
 *               createCr:
 *                 type: string
 *                 description: CR reference
 *                 example: "CR-2024-001"
 *           examples:
 *             updateStatus:
 *               summary: Update Status
 *               value:
 *                 status: "In progress"
 *             updateDates:
 *               summary: Update Dates
 *               value:
 *                 startDate: "2026-01-15"
 *                 endDate: "2026-12-15"
 *             updateAll:
 *               summary: Update All Fields
 *               value:
 *                 name: "Ariba Implementation - Phase 2"
 *                 clientName: "SAP Ariba"
 *                 description: "Phase 2 implementation of Ariba procurement platform"
 *                 status: "In progress"
 *                 projectType: "Implementation"
 *                 teamLead: "John Doe"
 *                 startDate: "2026-01-01"
 *                 endDate: "2026-12-31"
 *
 *     responses:
 *       200:
 *         description: Project updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: integer
 *                   example: 1
 *                 project_name:
 *                   type: string
 *                   example: "Ariba Implementation - Phase 2"
 *                 client_name:
 *                   type: string
 *                   example: "SAP Ariba"
 *                 description:
 *                   type: string
 *                   example: "Phase 2 implementation of Ariba procurement platform"
 *                 nbd_id:
 *                   type: string
 *                   example: "NBD-2024-001"
 *                 o2d_id:
 *                   type: string
 *                   example: "O2D-2024-001"
 *                 project_code:
 *                   type: string
 *                   example: "ARB-001"
 *                 sub_category:
 *                   type: string
 *                   example: "Procurement"
 *                 start_date:
 *                   type: string
 *                   format: date
 *                   example: "2026-01-01"
 *                 end_date:
 *                   type: string
 *                   format: date
 *                   example: "2026-12-31"
 *                 status:
 *                   type: string
 *                   example: "In progress"
 *                 project_type:
 *                   type: string
 *                   example: "Implementation"
 *                 team_lead:
 *                   type: string
 *                   example: "John Doe"
 *                 create_cr:
 *                   type: string
 *                   nullable: true
 *                   example: "CR-2024-001"
 *             example:
 *               id: 1
 *               project_name: "Ariba Implementation - Phase 2"
 *               client_name: "SAP Ariba"
 *               description: "Phase 2 implementation of Ariba procurement platform"
 *               nbd_id: "NBD-2024-001"
 *               o2d_id: "O2D-2024-001"
 *               project_code: "ARB-001"
 *               sub_category: "Procurement"
 *               start_date: "2026-01-01"
 *               end_date: "2026-12-31"
 *               status: "In progress"
 *               project_type: "Implementation"
 *               team_lead: "John Doe"
 *               create_cr: "CR-2024-001"
 *       
 *       400:
 *         description: Bad Request - Invalid data
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
 * /projects/{projectId}/effort:
 *   get:
 *     summary: Get Effort Estimates for Project
 *     description: |
 *       Retrieves all effort estimates for a specific project.
 *       
 *       ### Key Features:
 *       - Returns estimates per role (FE Dev, BE Dev, QA, etc.)
 *       - Includes effort days, hours, buffer days, hours
 *       - Shows total hours and units
 *       - Returns summary totals for quick reference
 *       
 *       ### Fields:
 *       - **effort_days**: Planned effort days
 *       - **effort_hrs**: Planned effort hours (calculated as days * 8)
 *       - **buffer_days**: Buffer days for contingency
 *       - **buffer_hrs**: Buffer hours (calculated as days * 8)
 *       - **total_hrs**: Total hours (effort + buffer)
 *       - **units**: Story points or other unit measure
 *       - **unit_label**: Label for units (e.g., "Story Points")
 *       
 *       ### Calculation:
 *       - effort_hrs = effort_days * 8
 *       - buffer_hrs = buffer_days * 8
 *       - total_hrs = effort_hrs + buffer_hrs
 *       
 *       ### Use Cases:
 *       - View project resource planning
 *       - Capacity planning
 *       - Budget estimation
 *       - Resource allocation
 *
 *     tags: [Projects]
 *     security:
 *       - bearerAuth: []
 *     
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema:
 *           type: integer
 *         description: Project ID
 *         example: 1
 *
 *     responses:
 *       200:
 *         description: Effort estimates retrieved successfully
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
 *                       id:
 *                         type: integer
 *                         example: 1
 *                       project_id:
 *                         type: integer
 *                         example: 1
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
 *                 totals:
 *                   type: object
 *                   properties:
 *                     effort_days:
 *                       type: number
 *                       format: decimal
 *                       example: 25.50
 *                     effort_hrs:
 *                       type: number
 *                       format: decimal
 *                       example: 204.00
 *                     buffer_days:
 *                       type: number
 *                       format: decimal
 *                       example: 5.00
 *                     buffer_hrs:
 *                       type: number
 *                       format: decimal
 *                       example: 40.00
 *                     total_hrs:
 *                       type: number
 *                       format: decimal
 *                       example: 244.00
 *             example:
 *               rows:
 *                 - id: 1
 *                   project_id: 1
 *                   role: "FE Dev"
 *                   effort_days: 10.50
 *                   effort_hrs: 84.00
 *                   buffer_days: 2.00
 *                   buffer_hrs: 16.00
 *                   total_hrs: 100.00
 *                   units: 20.00
 *                   unit_label: "Story Points"
 *                 - id: 2
 *                   project_id: 1
 *                   role: "BE Dev"
 *                   effort_days: 15.00
 *                   effort_hrs: 120.00
 *                   buffer_days: 3.00
 *                   buffer_hrs: 24.00
 *                   total_hrs: 144.00
 *                   units: 30.00
 *                   unit_label: "Story Points"
 *               totals:
 *                 effort_days: 25.50
 *                 effort_hrs: 204.00
 *                 buffer_days: 5.00
 *                 buffer_hrs: 40.00
 *                 total_hrs: 244.00
 *       
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       
 *       404:
 *         description: Project not found
 *       
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */

/**
 * @swagger
 * /projects/{projectId}/effort/bulk:
 *   post:
 *     summary: Bulk Upsert Effort Estimates
 *     description: |
 *       Creates or updates multiple effort estimates for a project in a single call.
 *       
 *       ### Key Features:
 *       - Upsert multiple roles at once
 *       - Automatic calculation of hours from days
 *       - Returns updated data with totals
 *       - Replaces all estimates for the project
 *       
 *       ### Automatic Calculations:
 *       - **effort_hrs** = effort_days × 8 hours/day
 *       - **buffer_hrs** = buffer_days × 8 hours/day
 *       - **total_hrs** = effort_hrs + buffer_hrs
 *       
 *       ### Upsert Logic:
 *       - If role exists: UPDATE
 *       - If role doesn't exist: INSERT
 *       - Unique key: (project_id, role)
 *       
 *       ### Use Cases:
 *       - Bulk upload effort estimates
 *       - Update resource planning
 *       - Project estimation
 *       - Capacity planning
 *
 *     tags: [Projects]
 *     security:
 *       - bearerAuth: []
 *     
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema:
 *           type: integer
 *         description: Project ID
 *         example: 1
 *     
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - rows
 *             properties:
 *               rows:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required:
 *                     - role
 *                   properties:
 *                     role:
 *                       type: string
 *                       description: Role name
 *                       example: "FE Dev"
 *                     effort_days:
 *                       type: number
 *                       format: decimal
 *                       description: Effort days
 *                       example: 10.50
 *                     buffer_days:
 *                       type: number
 *                       format: decimal
 *                       description: Buffer days
 *                       example: 2.00
 *                     units:
 *                       type: number
 *                       format: decimal
 *                       description: Unit count (story points)
 *                       example: 20.00
 *                     unit_label:
 *                       type: string
 *                       description: Unit label
 *                       example: "Story Points"
 *           examples:
 *             singleRole:
 *               summary: Single Role Estimate
 *               value:
 *                 rows:
 *                   - role: "FE Dev"
 *                     effort_days: 10.50
 *                     buffer_days: 2.00
 *                     units: 20.00
 *                     unit_label: "Story Points"
 *             multipleRoles:
 *               summary: Multiple Role Estimates
 *               value:
 *                 rows:
 *                   - role: "FE Dev"
 *                     effort_days: 10.50
 *                     buffer_days: 2.00
 *                     units: 20.00
 *                     unit_label: "Story Points"
 *                   - role: "BE Dev"
 *                     effort_days: 15.00
 *                     buffer_days: 3.00
 *                     units: 30.00
 *                     unit_label: "Story Points"
 *                   - role: "QA"
 *                     effort_days: 8.00
 *                     buffer_days: 1.50
 *                     units: 16.00
 *                     unit_label: "Story Points"
 *
 *     responses:
 *       200:
 *         description: Effort estimates saved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "Saved"
 *                 rows:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: integer
 *                         example: 1
 *                       project_id:
 *                         type: integer
 *                         example: 1
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
 *                 totals:
 *                   type: object
 *                   properties:
 *                     effort_days:
 *                       type: number
 *                       format: decimal
 *                     effort_hrs:
 *                       type: number
 *                       format: decimal
 *                     buffer_days:
 *                       type: number
 *                       format: decimal
 *                     buffer_hrs:
 *                       type: number
 *                       format: decimal
 *                     total_hrs:
 *                       type: number
 *                       format: decimal
 *             example:
 *               message: "Saved"
 *               rows:
 *                 - id: 1
 *                   project_id: 1
 *                   role: "FE Dev"
 *                   effort_days: 10.50
 *                   effort_hrs: 84.00
 *                   buffer_days: 2.00
 *                   buffer_hrs: 16.00
 *                   total_hrs: 100.00
 *                   units: 20.00
 *                   unit_label: "Story Points"
 *                 - id: 2
 *                   project_id: 1
 *                   role: "BE Dev"
 *                   effort_days: 15.00
 *                   effort_hrs: 120.00
 *                   buffer_days: 3.00
 *                   buffer_hrs: 24.00
 *                   total_hrs: 144.00
 *                   units: 30.00
 *                   unit_label: "Story Points"
 *               totals:
 *                 effort_days: 25.50
 *                 effort_hrs: 204.00
 *                 buffer_days: 5.00
 *                 buffer_hrs: 40.00
 *                 total_hrs: 244.00
 *       
 *       400:
 *         description: Bad Request - Missing rows
 *         content:
 *           application/json:
 *             example:
 *               message: "projectId and rows[] are required"
 *       
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */

/**
 * @swagger
 * /projects/{projectId}/effort:
 *   delete:
 *     summary: Delete All Effort Estimates
 *     description: |
 *       Deletes all effort estimates for a project.
 *       
 *       ### Key Features:
 *       - Removes all effort estimate records
 *       - Useful for resetting estimates
 *       - Cannot undo (hard delete)
 *       
 *       ### Use Cases:
 *       - Reset project estimates
 *       - Start fresh with new estimates
 *       - Clean up test data
 *
 *     tags: [Projects]
 *     security:
 *       - bearerAuth: []
 *     
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema:
 *           type: integer
 *         description: Project ID
 *         example: 1
 *
 *     responses:
 *       200:
 *         description: Effort estimates deleted successfully
 *         content:
 *           application/json:
 *             example:
 *               message: "Effort estimate cleared"
 *       
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       
 *       404:
 *         description: Project not found
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
