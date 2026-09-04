const express = require('express');
const router = express.Router();
const multer = require('multer');
const { authMiddleware } = require('../middleware/auth.middleware');
const { 
    uploadTimesheet, 
    getBatches, 
    getBatchDetails, 
    getProjectReconciliation,
    getEmployeeReconciliation,
    getBatchReconciliation
} = require('../controller/timesheet.controller');

// Configure multer for file upload
const upload = multer({ storage: multer.memoryStorage() });

// Upload API - Stores ALL data
router.post('/upload', authMiddleware, upload.single('file'), uploadTimesheet);

// Batch Management APIs 
router.get('/batches', authMiddleware, getBatches);
router.get('/batches/:id', authMiddleware, getBatchDetails);


// Reconciliation APIs
router.get('/reconciliation/project/:projectId', authMiddleware, getProjectReconciliation);
router.get('/reconciliation/employee/:userId', authMiddleware, getEmployeeReconciliation);
router.get('/reconciliation/batch/:batchId', authMiddleware, getBatchReconciliation);

module.exports = router;

/**
 * @swagger
 * tags:
 *   - name: Timesheet
 *     description: Timesheet management APIs - Upload, view batches, and reconciliation
 */

/**
 * @swagger
 * /timesheet/upload:
 *   post:
 *     summary: Upload Timesheet Excel File
 *     description: |
 *       Uploads an Excel file containing timesheet data for processing.
 *       
 *       ### Key Features:
 *       - Upload Excel file (xlsx/xls format)
 *       - Auto-detects and processes weekly timesheet data
 *       - Handles duplicate entries (skips existing)
 *       - Maps employees and projects from master data
 *       - Creates batch record for tracking
 *       - Provides detailed warnings for missing data
 *       
 *       ### Excel Format Requirements:
 *       Required columns:
 *       - **Employee Code**: Employee identifier
 *       - **Project Code**: Project identifier
 *       - **Project Name**: Name of the project
 *       - **Client Name**: Client name
 *       - **From Date**: Start date of the week
 *       - **To Date**: End date of the week
 *       - **Monday**: Hours logged on Monday
 *       - **Tuesday**: Hours logged on Tuesday
 *       - **Wednesday**: Hours logged on Wednesday
 *       - **Thursday**: Hours logged on Thursday
 *       - **Friday**: Hours logged on Friday
 *       - **Monday Description**: Work description for Monday
 *       - **Tuesday Description**: Work description for Tuesday
 *       - **Wednesday Description**: Work description for Wednesday
 *       - **Thursday Description**: Work description for Thursday
 *       - **Friday Description**: Work description for Friday
 *       
 *       ### Processing Logic:
 *       1. Reads Excel file and validates format
 *       2. Maps Employee Code to u_id from master.emp
 *       3. Maps Project Code to project_id
 *       4. Creates entries for each day with hours > 0
 *       5. Skips duplicate entries (same emp, project, date, day)
 *       6. Flags missing employees and projects
 *       7. Stores batch information for tracking
 *       
 *       ### Use Cases:
 *       - Weekly timesheet upload
 *       - Employee time tracking
 *       - Payroll processing
 *       - Resource utilization tracking
 *
 *     tags: [Timesheet]
 *     security:
 *       - bearerAuth: []
 *     
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *                 description: Excel file (.xlsx or .xls)
 *           example:
 *             file: [binary file data]
 *
 *     responses:
 *       200:
 *         description: Timesheet uploaded successfully
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
 *                   example: "Timesheet uploaded successfully."
 *                 data:
 *                   type: object
 *                   properties:
 *                     batch_id:
 *                       type: integer
 *                       example: 1
 *                     batch_code:
 *                       type: string
 *                       example: "BATCH-12345678"
 *                     total_records:
 *                       type: integer
 *                       example: 10
 *                     total_entries_stored:
 *                       type: integer
 *                       example: 48
 *                     duplicate_entries:
 *                       type: integer
 *                       example: 2
 *                     status:
 *                       type: string
 *                       example: "draft"
 *                 warnings:
 *                   type: object
 *                   properties:
 *                     employee_not_found:
 *                       type: object
 *                       properties:
 *                         count:
 *                           type: integer
 *                           example: 2
 *                         employees:
 *                           type: array
 *                           items:
 *                             type: string
 *                           example: ["EMP001", "EMP002"]
 *                         message:
 *                           type: string
 *                           example: "These employees need to be added to master.emp"
 *                     project_not_found:
 *                       type: object
 *                       properties:
 *                         count:
 *                           type: integer
 *                           example: 1
 *                         projects:
 *                           type: array
 *                           items:
 *                             type: string
 *                           example: ["PROJ001"]
 *                         message:
 *                           type: string
 *                           example: "These projects need to be created in the system"
 *                     no_hours:
 *                       type: object
 *                       properties:
 *                         count:
 *                           type: integer
 *                           example: 2
 *                         message:
 *                           type: string
 *                           example: "Rows with zero hours logged"
 *                     invalid_dates:
 *                       type: object
 *                       properties:
 *                         count:
 *                           type: integer
 *                           example: 1
 *                         message:
 *                           type: string
 *                           example: "Rows with invalid dates"
 *                     duplicates:
 *                       type: object
 *                       properties:
 *                         count:
 *                           type: integer
 *                           example: 2
 *                         details:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               employee_code:
 *                                 type: string
 *                               project_code:
 *                                 type: string
 *                               date:
 *                                 type: string
 *                               day:
 *                                 type: string
 *                               hours:
 *                                 type: number
 *                               existing_hours:
 *                                 type: number
 *                 missing_projects:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       project_code:
 *                         type: string
 *                       project_name:
 *                         type: string
 *             example:
 *               success: true
 *               message: "Timesheet uploaded successfully."
 *               data:
 *                 batch_id: 1
 *                 batch_code: "BATCH-12345678"
 *                 total_records: 10
 *                 total_entries_stored: 48
 *                 duplicate_entries: 2
 *                 status: "draft"
 *               warnings:
 *                 employee_not_found:
 *                   count: 0
 *                   employees: []
 *                   message: "These employees need to be added to master.emp"
 *                 project_not_found:
 *                   count: 1
 *                   projects: ["PROJ001"]
 *                   message: "These projects need to be created in the system"
 *                 no_hours:
 *                   count: 0
 *                   message: "Rows with zero hours logged"
 *                 invalid_dates:
 *                   count: 0
 *                   message: "Rows with invalid dates"
 *                 duplicates:
 *                   count: 2
 *                   details:
 *                     - employee_code: "EMP001"
 *                       project_code: "PROJ001"
 *                       date: "2026-07-20"
 *                       day: "Monday"
 *                       hours: 8
 *                       existing_hours: 8
 *               missing_projects:
 *                 - project_code: "PROJ001"
 *                   project_name: "Unknown Project"
 *       
 *       400:
 *         description: Bad Request - No file or invalid format
 *         content:
 *           application/json:
 *             examples:
 *               noFile:
 *                 value:
 *                   message: "No file uploaded"
 *               emptyFile:
 *                 value:
 *                   message: "Excel file is empty or invalid format"
 *       
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */

/**
 * @swagger
 * /timesheet/batches:
 *   get:
 *     summary: Get All Timesheet Batches
 *     description: |
 *       Retrieves all timesheet upload batches.
 *       
 *       ### Key Features:
 *       - Returns all batches ordered by creation date (newest first)
 *       - Includes employee details from master.emp
 *       - Shows entry counts and date ranges
 *       - Includes batch status and file information
 *       
 *       ### Batch Status:
 *       - **draft**: Initial upload state
 *       - **validated**: Records validated
 *       - **submitted**: Submitted for review
 *       - **approved**: Approved
 *       - **rejected**: Rejected
 *       
 *       ### Use Cases:
 *       - Timesheet history
 *       - Batch management
 *       - Audit trail
 *       - Compliance tracking
 *
 *     tags: [Timesheet]
 *     security:
 *       - bearerAuth: []
 *
 *     responses:
 *       200:
 *         description: Batches retrieved successfully
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
 *                       batch_code:
 *                         type: string
 *                         example: "BATCH-12345678"
 *                       uploaded_by:
 *                         type: integer
 *                         example: 123
 *                       uploaded_by_name:
 *                         type: string
 *                         example: "Bedasur Veeranna"
 *                       uploaded_by_emp_id:
 *                         type: string
 *                         example: "AS02288"
 *                       file_name:
 *                         type: string
 *                         example: "timesheet_july_2026.xlsx"
 *                       total_records:
 *                         type: integer
 *                         example: 10
 *                       valid_records:
 *                         type: integer
 *                         example: 8
 *                       invalid_records:
 *                         type: integer
 *                         example: 2
 *                       status:
 *                         type: string
 *                         enum: [draft, validated, submitted, rejected, approved]
 *                         example: "draft"
 *                       created_at:
 *                         type: string
 *                         format: date-time
 *                         example: "2026-07-23T10:30:00.000Z"
 *                       total_entries:
 *                         type: integer
 *                         example: 48
 *                       earliest_date:
 *                         type: string
 *                         format: date
 *                         example: "2026-07-20"
 *                       latest_date:
 *                         type: string
 *                         format: date
 *                         example: "2026-07-24"
 *             example:
 *               success: true
 *               data:
 *                 - id: 1
 *                   batch_code: "BATCH-12345678"
 *                   uploaded_by: 123
 *                   uploaded_by_name: "Bedasur Veeranna"
 *                   uploaded_by_emp_id: "AS02288"
 *                   file_name: "timesheet_july_2026.xlsx"
 *                   total_records: 10
 *                   valid_records: 8
 *                   invalid_records: 2
 *                   status: "draft"
 *                   created_at: "2026-07-23T10:30:00.000Z"
 *                   total_entries: 48
 *                   earliest_date: "2026-07-20"
 *                   latest_date: "2026-07-24"
 *       
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */

/**
 * @swagger
 * /timesheet/batches/{id}:
 *   get:
 *     summary: Get Batch Details
 *     description: |
 *       Retrieves detailed information for a specific timesheet batch.
 *       
 *       ### Key Features:
 *       - Full batch information
 *       - All entries with employee and project details
 *       - Summary statistics
 *       - Missing data tracking
 *       
 *       ### Included Data:
 *       - Batch metadata (status, dates, counts)
 *       - Entry details with employee/project mapping
 *       - Missing employee and project counts
 *       - Total hours and unique counts
 *       
 *       ### Use Cases:
 *       - Batch review
 *       - Data validation
 *       - Error correction
 *       - Timesheet audit
 *
 *     tags: [Timesheet]
 *     security:
 *       - bearerAuth: []
 *     
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Batch ID
 *         example: 1
 *
 *     responses:
 *       200:
 *         description: Batch details retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 batch:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: integer
 *                     batch_code:
 *                       type: string
 *                     uploaded_by:
 *                       type: integer
 *                     uploaded_by_name:
 *                       type: string
 *                     uploaded_by_emp_id:
 *                       type: string
 *                     file_name:
 *                       type: string
 *                     total_records:
 *                       type: integer
 *                     valid_records:
 *                       type: integer
 *                     invalid_records:
 *                       type: integer
 *                     status:
 *                       type: string
 *                     created_at:
 *                       type: string
 *                 summary:
 *                   type: object
 *                   properties:
 *                     total_entries:
 *                       type: integer
 *                     total_hours:
 *                       type: number
 *                     unique_employees:
 *                       type: integer
 *                     unique_projects:
 *                       type: integer
 *                     missing_employees:
 *                       type: integer
 *                     missing_projects:
 *                       type: integer
 *                 entries:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: integer
 *                       user_id:
 *                         type: integer
 *                       emp_id:
 *                         type: string
 *                       employee_name:
 *                         type: string
 *                       original_emp_code:
 *                         type: string
 *                       project_id:
 *                         type: integer
 *                       project_name:
 *                         type: string
 *                       project_code:
 *                         type: string
 *                       original_project_name:
 *                         type: string
 *                       entry_date:
 *                         type: string
 *                         format: date
 *                       hours:
 *                         type: number
 *                         format: decimal
 *                       description:
 *                         type: string
 *                       day_of_week:
 *                         type: string
 *                       employee_found:
 *                         type: boolean
 *                       project_found:
 *                         type: boolean
 *                       reconciliation_status:
 *                         type: string
 *             example:
 *               success: true
 *               batch:
 *                 id: 1
 *                 batch_code: "BATCH-12345678"
 *                 uploaded_by: 123
 *                 uploaded_by_name: "Bedasur Veeranna"
 *                 uploaded_by_emp_id: "AS02288"
 *                 file_name: "timesheet_july_2026.xlsx"
 *                 total_records: 10
 *                 valid_records: 8
 *                 invalid_records: 2
 *                 status: "draft"
 *                 created_at: "2026-07-23T10:30:00.000Z"
 *               summary:
 *                 total_entries: 48
 *                 total_hours: 360.0
 *                 unique_employees: 5
 *                 unique_projects: 3
 *                 missing_employees: 0
 *                 missing_projects: 1
 *               entries:
 *                 - id: 1
 *                   user_id: 123
 *                   emp_id: "AS02288"
 *                   employee_name: "Bedasur Veeranna"
 *                   original_emp_code: "AS02288"
 *                   project_id: 61
 *                   project_name: "Ariba"
 *                   project_code: "ARB-001"
 *                   original_project_name: "Ariba Project"
 *                   entry_date: "2026-07-20"
 *                   hours: 8.0
 *                   description: "UI Development"
 *                   day_of_week: "Monday"
 *                   employee_found: true
 *                   project_found: true
 *                   reconciliation_status: "pending"
 *       
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       
 *       404:
 *         description: Batch not found
 *         content:
 *           application/json:
 *             example:
 *               message: "Batch not found"
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