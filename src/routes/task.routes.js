const express = require('express');
const router = express.Router();

const {authMiddleware} = require('../middleware/auth.middleware');
// const { createTask, getTasksByProjectId } = require('../controller/task.controller');
const taskController = require('../controller/task.controller');

// POST / - create task (protected)
router.post('/', authMiddleware, taskController.createTask);

// GET /?projectId= - get tasks by projectId (protected)
router.get('/', authMiddleware, (req, res, next) => {
  // Adapt query parameter to what the controller expects
  req.params.projectId = req.query.projectId;
  return taskController.getTasksByProjectId(req, res, next);
});

/**
 * @swagger
 * tags:
 *   - name: Tasks
 *     description: Task management APIs - Create and view project tasks
 */

/**
 * @swagger
 * /tasks:
 *   post:
 *     summary: Create a New Task
 *     description: |
 *       Creates a new task in the system.
 *       
 *       ### Key Features:
 *       - Associate task with a project
 *       - Assign to a specific user
 *       - Set task name and planned units
 *       - Auto-generates task ID
 *       
 *       ### Required Fields:
 *       - **project_id**: Project identifier
 *       - **task_name**: Name/description of the task
 *       
 *       ### Optional Fields:
 *       - **assigned_user_id**: User ID to assign the task to
 *       - **planned_units**: Number of units planned (default: 0)
 *       
 *       ### Use Cases:
 *       - Create work breakdown structure
 *       - Define project deliverables
 *       - Assign work to team members
 *       - Project planning
 *
 *     tags: [Tasks]
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
 *               - task_name
 *             properties:
 *               project_id:
 *                 type: integer
 *                 description: Project ID
 *                 example: 61
 *               assigned_user_id:
 *                 type: integer
 *                 description: User ID to assign the task to
 *                 example: 123
 *               task_name:
 *                 type: string
 *                 description: Name/description of the task
 *                 example: "Implement Login Page"
 *               planned_units:
 *                 type: integer
 *                 description: Number of units planned for this task
 *                 example: 5
 *           examples:
 *             basicTask:
 *               summary: Basic Task Creation
 *               value:
 *                 project_id: 61
 *                 task_name: "Implement Login Page"
 *                 planned_units: 5
 *             assignedTask:
 *               summary: Task with Assignment
 *               value:
 *                 project_id: 61
 *                 assigned_user_id: 123
 *                 task_name: "Implement Login Page"
 *                 planned_units: 5
 *             fullTask:
 *               summary: Full Task Details
 *               value:
 *                 project_id: 61
 *                 assigned_user_id: 123
 *                 task_name: "Implement Login Page with Authentication"
 *                 planned_units: 8
 *
 *     responses:
 *       201:
 *         description: Task created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: integer
 *                   description: Auto-generated task ID
 *                   example: 1
 *                 project_id:
 *                   type: integer
 *                   example: 61
 *                 assigned_user_id:
 *                   type: integer
 *                   nullable: true
 *                   example: 123
 *                 task_name:
 *                   type: string
 *                   example: "Implement Login Page"
 *                 planned_units:
 *                   type: integer
 *                   example: 5
 *             example:
 *               id: 1
 *               project_id: 61
 *               assigned_user_id: 123
 *               task_name: "Implement Login Page"
 *               planned_units: 5
 *       
 *       400:
 *         description: Bad Request - Missing required fields
 *         content:
 *           application/json:
 *             example:
 *               message: "Missing required fields"
 *       
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */

/**
 * @swagger
 * /tasks:
 *   get:
 *     summary: Get Tasks by Project
 *     description: |
 *       Retrieves all tasks for a specific project.
 *       
 *       ### Key Features:
 *       - Returns all tasks for a project
 *       - Ordered by ID ascending
 *       - Shows task details including assignment
 *       
 *       ### Use Cases:
 *       - View project work breakdown
 *       - Track project tasks
 *       - Task management dashboard
 *       - Project planning review
 *
 *     tags: [Tasks]
 *     security:
 *       - bearerAuth: []
 *     
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
 *         description: Tasks retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id:
 *                     type: integer
 *                     description: Task ID
 *                     example: 1
 *                   project_id:
 *                     type: integer
 *                     description: Project ID
 *                     example: 61
 *                   assigned_user_id:
 *                     type: integer
 *                     nullable: true
 *                     description: ID of assigned user
 *                     example: 123
 *                   task_name:
 *                     type: string
 *                     description: Task name
 *                     example: "Implement Login Page"
 *                   planned_units:
 *                     type: integer
 *                     description: Planned units for the task
 *                     example: 5
 *             example:
 *               - id: 1
 *                 project_id: 61
 *                 assigned_user_id: 123
 *                 task_name: "Implement Login Page"
 *                 planned_units: 5
 *               - id: 2
 *                 project_id: 61
 *                 assigned_user_id: 124
 *                 task_name: "Design Database Schema"
 *                 planned_units: 3
 *               - id: 3
 *                 project_id: 61
 *                 assigned_user_id: null
 *                 task_name: "Write API Documentation"
 *                 planned_units: 2
 *       
 *       400:
 *         description: Bad Request - Missing projectId
 *         content:
 *           application/json:
 *             example:
 *               message: "projectId is required"
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

module.exports = router;