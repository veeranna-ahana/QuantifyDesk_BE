const express = require('express');
const router = express.Router();
const { getDeliveryEmployeeDetails } = require('../controller/employeesController');
const { authMiddleware } = require('../middleware/auth.middleware');

// Protected — needs req.user.emp_id for the UAT token lookup
router.get('/delivery-details', authMiddleware, getDeliveryEmployeeDetails);

/**
 * @swagger
 * /employees/delivery-details:
 *   get:
 *     summary: Get delivery employee details
 *     description: Returns delivery employees with their skills, assigned projects, and PMS availability.
 *     tags:
 *       - Employees
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Delivery employee details retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 total:
 *                   type: integer
 *                   example: 1
 *                 employees:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       emp_id:
 *                         type: string
 *                         example: EMP001
 *                       emp_name:
 *                         type: string
 *                         example: Alex Morgan
 *                       designation:
 *                         type: string
 *                         example: Software Engineer
 *                       department:
 *                         type: string
 *                         example: Delivery
 *                       email:
 *                         type: string
 *                         format: email
 *                         example: alex.morgan@example.com
 *                       doj:
 *                         type: string
 *                         nullable: true
 *                         example: 2022-04-15
 *                       experience_years:
 *                         type: number
 *                         example: 3.5
 *                       skills:
 *                         type: array
 *                         items:
 *                           type: string
 *                       sub_skills:
 *                         type: array
 *                         items:
 *                           type: string
 *                       projects:
 *                         type: array
 *                         items:
 *                           type: string
 *                       available:
 *                         type: string
 *                         nullable: true
 *                         description: immediate, a latest project end date, or null when unavailable
 *                         example: immediate
 *       401:
 *         description: Authorization token missing, invalid, or PMS session unavailable
 *       500:
 *         description: Failed to load delivery employee details
 */

module.exports = router;