const express = require('express');
const router = express.Router();
const { syncHrmsTimesheets, getHrmsTimesheets,  getCategoryTimesheetsGroupedByEmployee, 
 } = require('../controller/projectTimesheet.controller');

// POST /api/hrms/sync-timesheets
// Body (optional): { "projectCodes": ["D:SS2:NC:GENACT", "I:A&A:SP:PROJCT"] }
router.post('/sync-timesheets', syncHrmsTimesheets);

// GET /api/hrms/timesheets?project_code=...&employee_id=...&from_date=...&to_date=...
router.get('/timesheets', getHrmsTimesheets);

router.get('/timesheets-by-category', getCategoryTimesheetsGroupedByEmployee); 

module.exports = router;

/**
 * @swagger
 * tags:
 *   - name: HRMS Timesheets
 *     description: HRMS timesheet synchronization, retrieval, and aggregation APIs
 */

/**
 * @swagger
 * /hrms/sync-timesheets:
 *   post:
 *     summary: Synchronize HRMS timesheets
 *     description: Triggers an HRMS timesheet synchronization. If project codes are provided, only those projects are synchronized.
 *     tags: [HRMS Timesheets]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               projectCodes:
 *                 type: array
 *                 items:
 *                   type: string
 *                 example: ["D:SS2:NC:GENACT", "I:A&A:SP:PROJCT"]
 *     responses:
 *       200:
 *         description: HRMS timesheets synchronized successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *         
 *       500:
 *         description: Failed to synchronize HRMS timesheets
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/HrmsTimesheetError'
 */

/**
 * @swagger
 * /hrms/timesheets:
 *   get:
 *     summary: Get HRMS timesheets
 *     description: Returns stored HRMS timesheet rows, optionally filtered by project, employee, or date range.
 *     tags: [HRMS Timesheets]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: project_code
 *         schema:
 *           type: string
 *         description: Filter by project code
 *       - in: query
 *         name: employee_id
 *         schema:
 *           type: string
 *         description: Filter by employee ID
 *       - in: query
 *         name: from_date
 *         schema:
 *           type: string
 *           format: date
 *         description: Return rows whose start date is on or after this date
 *       - in: query
 *         name: to_date
 *         schema:
 *           type: string
 *           format: date
 *         description: Return rows whose end date is on or before this date
 *     responses:
 *       200:
 *         description: HRMS timesheets retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 count:
 *                   type: integer
 *                   example: 2
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/HrmsTimesheet'
 *       500:
 *         description: Failed to load HRMS timesheets
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/HrmsTimesheetError'
 */

/**
 * @swagger
 * /hrms/timesheets-by-category:
 *   get:
 *     summary: Get HRMS timesheets grouped by employee and category
 *     description: Aggregates HRMS timesheet rows for a project category into one record per employee.
 *     tags: [HRMS Timesheets]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: projectcategory_code
 *         required: true
 *         schema:
 *           type: string
 *         description: Project category code used to filter timesheets
 *     responses:
 *       200:
 *         description: Grouped HRMS timesheets retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 projectcategory_code:
 *                   type: string
 *                   example: NBD3011
 *                 count:
 *                   type: integer
 *                   example: 1
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/HrmsTimesheetGrouped'
 *       400:
 *         description: Project category code is required
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: projectcategory_code is required
 *       500:
 *         description: Failed to load grouped HRMS timesheets
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/HrmsTimesheetError'
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     HrmsTimesheet:
 *       type: object
 *       description: A stored HRMS timesheet row. Additional columns from the HRMS source may also be returned.
 *       properties:
 *         employee_id:
 *           type: string
 *           example: EMP001
 *         employee_name:
 *           type: string
 *           example: Jane Doe
 *         project_code:
 *           type: string
 *           example: D:SS2:NC:GENACT
 *         project_name:
 *           type: string
 *           example: General Activities
 *         projectcategory_code:
 *           type: string
 *           example: NBD3011
 *         from_date:
 *           type: string
 *           format: date
 *         to_date:
 *           type: string
 *           format: date
 *         number_of_hours:
 *           type: number
 *           format: double
 *           example: 8
 *         approval_status:
 *           type: string
 *           example: Approved
 *     HrmsTimesheetGrouped:
 *       type: object
 *       properties:
 *         employee_id:
 *           type: string
 *           example: EMP001
 *         employee_name:
 *           type: string
 *           example: Jane Doe
 *         designation:
 *           type: string
 *         department:
 *           type: string
 *         employee_email:
 *           type: string
 *           format: email
 *         employee_phone:
 *           type: string
 *         reporting_manager:
 *           type: string
 *         employment_type:
 *           type: string
 *         project_code:
 *           type: string
 *         project_name:
 *           type: string
 *         projectcategory_code:
 *           type: string
 *         projectcategory_name:
 *           type: string
 *         from_date:
 *           type: string
 *           format: date
 *         to_date:
 *           type: string
 *           format: date
 *         total_hours:
 *           type: number
 *           format: double
 *         entries:
 *           type: integer
 *         approved:
 *           type: integer
 *         pending:
 *           type: integer
 *         rejected:
 *           type: integer
 *         last_approved_by:
 *           type: string
 *           nullable: true
 *         last_approved_on:
 *           type: string
 *           nullable: true
 *         overall_status:
 *           type: string
 *           enum: [Approved, Pending, Rejected, Mixed]
 *     HrmsTimesheetError:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           example: false
 *         message:
 *           type: string
 *           example: Failed to load HRMS timesheets
 *         error:
 *           type: string
 */