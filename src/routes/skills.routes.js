const express = require('express');
const router = express.Router();
const { getSkillAnalytics } = require('../controller/skillAnalyticsController');
const { authMiddleware } = require('../middleware/auth.middleware');

router.get('/analytics', authMiddleware, getSkillAnalytics);

/**
 * @swagger
 * /skills/analytics:
 *   get:
 *     summary: Get skill analytics
 *     description: Returns employees grouped by skill, with optional department, skill, and sub-skill filters.
 *     tags:
 *       - Skills
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: department
 *         schema:
 *           type: string
 *           default: Delivery
 *         description: Department to include. Use 'all' to disable department filtering.
 *         example: Delivery
 *       - in: query
 *         name: skill
 *         schema:
 *           type: string
 *         description: Filter results to a skill.
 *         example: Java
 *       - in: query
 *         name: include_sub_skills
 *         schema:
 *           type: boolean
 *           default: false
 *         description: Include employee groups for sub-skills in the response.
 *     responses:
 *       200:
 *         description: Skill analytics retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 total_skills:
 *                   type: integer
 *                   example: 2
 *                 filters:
 *                   type: object
 *                   properties:
 *                     department:
 *                       type: string
 *                       example: Delivery
 *                     skill:
 *                       type: string
 *                       nullable: true
 *                       example: Java
 *                     include_sub_skills:
 *                       type: boolean
 *                       example: false
 *                 skills:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       skill_name:
 *                         type: string
 *                         example: Java
 *                       employee_count:
 *                         type: integer
 *                         example: 1
 *                       employees:
 *                         type: array
 *                         items:
 *                           type: object
 *                           properties:
 *                             emp_id:
 *                               type: string
 *                               example: EMP001
 *                             emp_name:
 *                               type: string
 *                               example: Alex Morgan
 *                             designation:
 *                               type: string
 *                               example: Software Engineer
 *                             department:
 *                               type: string
 *                               example: Delivery
 *                             experience_years:
 *                               type: number
 *                               example: 3.5
 *                             projects:
 *                               type: array
 *                               items:
 *                                 type: string
 *                 sub_skills:
 *                   type: array
 *                   description: Included only when include_sub_skills is true.
 *                   items:
 *                     type: object
 *                     properties:
 *                       skill_name:
 *                         type: string
 *                       employee_count:
 *                         type: integer
 *                       employees:
 *                         type: array
 *                         items:
 *                           type: object
 *       401:
 *         description: Authorization token missing, invalid, or PMS session unavailable
 *       500:
 *         description: Failed to load skill analytics
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
 *                   example: Failed to load skill analytics
 *                 error:
 *                   type: string
 */

module.exports = router;