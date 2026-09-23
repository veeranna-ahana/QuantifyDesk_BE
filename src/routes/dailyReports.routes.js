
const express = require('express');
const router = express.Router();

const { authMiddleware, adminOnly } = require('../middleware/auth.middleware');
const {
  fetchStoredPmsProjects,
  fetchProjectTasks
} = require('../controller/dailyReport.controller');

/**
 * @swagger
 * tags:
 *   - name: Daily Reports
 *     description: Project and task reporting APIs
 */

/**
 * @swagger
 * /daily-reports/stored-projects:
 *   get:
 *     summary: Get Stored PMS Projects
 *     description: Returns projects available in PMS that are also stored in Quantify, grouped by project status.
 *     tags: [Daily Reports]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Stored projects grouped by status
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 counts:
 *                   type: object
 *                   properties:
 *                     all:
 *                       type: integer
 *                       example: 12
 *                     completed:
 *                       type: integer
 *                       example: 3
 *                     inprogress:
 *                       type: integer
 *                       example: 4
 *                     waiting_for_approval:
 *                       type: integer
 *                       example: 2
 *                     rejected:
 *                       type: integer
 *                       example: 1
 *                     on_hold:
 *                       type: integer
 *                       example: 2
 *                     inactive:
 *                       type: integer
 *                       example: 1
 *                 total_from_pms:
 *                   type: integer
 *                   example: 15
 *                 total_stored:
 *                   type: integer
 *                   example: 13
 *                 all:
 *                   type: array
 *                   items:
 *                     type: object
 *                     additionalProperties: true
 *                 completed:
 *                   type: array
 *                   items:
 *                     type: object
 *                     additionalProperties: true
 *                 inprogress:
 *                   type: array
 *                   items:
 *                     type: object
 *                     additionalProperties: true
 *                 waiting_for_approval:
 *                   type: array
 *                   items:
 *                     type: object
 *                     additionalProperties: true
 *                 rejected:
 *                   type: array
 *                   items:
 *                     type: object
 *                     additionalProperties: true
 *                 on_hold:
 *                   type: array
 *                   items:
 *                     type: object
 *                     additionalProperties: true
 *       401:
 *         description: Authentication failed with PMS
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/PmsError'
 *       500:
 *         description: Failed to communicate with PMS
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/PmsError'
 */
router.get('/stored-projects', fetchStoredPmsProjects); 

/**
 * @swagger
 * /daily-reports/project-tasks:
 *   get:
 *     summary: Get Project Tasks
 *     description: Returns tasks for a PMS project grouped by task status.
 *     tags: [Daily Reports]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: projectId
 *         required: true
 *         description: PMS project identifier
 *         schema:
 *           type: integer
 *           example: 639
 *     responses:
 *       200:
 *         description: Project tasks grouped by status
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 project_id:
 *                   type: integer
 *                   example: 639
 *                 total_tasks:
 *                   type: integer
 *                   example: 24
 *                 total_milestones:
 *                   type: integer
 *                   example: 6
 *                 counts:
 *                   type: object
 *                   properties:
 *                     YET_TO_START:
 *                       type: integer
 *                       example: 8
 *                     STARTED:
 *                       type: integer
 *                       example: 10
 *                     COMPLETED:
 *                       type: integer
 *                       example: 6
 *                     DELAYED:
 *                       type: integer
 *                       example: 2
 *                     ALL:
 *                       type: integer
 *                       example: 16
 *                 all:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/DailyReportTask'
 *                 in_progress:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/DailyReportTask'
 *                 all_completed:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/DailyReportTask'
 *                 not_yet_started:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/DailyReportTask'
 *                 delayed:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/DailyReportTask'
 *                 last_completed_by_employee:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/DailyReportTask'
 *       400:
 *         description: Project ID is missing
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
 *                   example: projectId is required
 *       401:
 *         description: Authentication failed with PMS
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/PmsError'
 *       500:
 *         description: Failed to communicate with PMS
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/PmsError'
 */
router.get('/project-tasks', fetchProjectTasks);

/**
 * @swagger
 * components:
 *   schemas:
 *     DailyReportTask:
 *       type: object
 *       properties:
 *         task_id:
 *           type: integer
 *           example: 1001
 *         task_title:
 *           type: string
 *           example: Implement dashboard filters
 *         task_uuid:
 *           type: string
 *           example: 7f2f5e5e-2b9c-4de2-a12d-123456789abc
 *         status:
 *           type: string
 *           example: STARTED
 *         emp_id:
 *           type: integer
 *           example: 42
 *         emp_name:
 *           type: string
 *           example: Jane Doe
 *         planned_start_date:
 *           type: string
 *           format: date-time
 *         planned_end_date:
 *           type: string
 *           format: date-time
 *         actual_start_date:
 *           type: string
 *           format: date-time
 *           nullable: true
 *         actual_end_date:
 *           type: string
 *           format: date-time
 *           nullable: true
 *         project_milestone_id:
 *           type: integer
 *           nullable: true
 *         role:
 *           type: string
 *           nullable: true
 *           example: FE Dev
 *         task_type:
 *           type: string
 *           nullable: true
 *           example: Development
 *         unit:
 *           type: string
 *           nullable: true
 *           example: Hours
 *     PmsError:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           example: false
 *         message:
 *           type: string
 *           example: PMS API error
 *         error:
 *           type: string
 *           example: Invalid or expired token
 */

module.exports = router;