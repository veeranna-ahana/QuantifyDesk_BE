const express = require("express");
const router = express.Router();

const { authMiddleware } = require("../middleware/auth.middleware");
const {
  getServerOptions,
  getServerProjects,
  getAssignedProjectOptions,
  getServers,
  getServerById,
  createServer,
  updateServer,
} = require("../controller/server.controller");

// GET  /api/servers/options             Environment / Initial Status / OS dropdown lists (backend constants)
// GET  /api/servers/projects            Allocated Projects options for Add/Edit Server (PMS unique titles + custom ones)
// GET  /api/servers/assigned-projects   Distinct projects actually assigned to a server, for the list's Filter popup
// GET  /api/servers                     list (page, pageSize, search) + activeCount
// GET  /api/servers/:id                 one server (Edit Server pre-fill)
// POST /api/servers                     create
// PUT  /api/servers/:id                 update
// The fixed paths must stay above "/:id".
router.get("/options", authMiddleware, getServerOptions);
router.get("/projects", authMiddleware, getServerProjects);
router.get("/assigned-projects", authMiddleware, getAssignedProjectOptions);
router.get("/", authMiddleware, getServers);
router.get("/:id", authMiddleware, getServerById);
router.post("/", authMiddleware, createServer);
router.put("/:id", authMiddleware, updateServer);

module.exports = router;

/**
 * @swagger
 * tags:
 *   - name: Servers
 *     description: Server Information - list, view, add and edit
 *
 * components:
 *   schemas:
 *     Server:
 *       type: object
 *       properties:
 *         id:
 *           type: integer
 *           example: 1
 *         serverName:
 *           type: string
 *           example: "server1"
 *         ipAddress:
 *           type: string
 *           example: "10.24.168.105"
 *         ram:
 *           type: string
 *           example: "32GB"
 *         cpu:
 *           type: string
 *           example: "8 core"
 *         storage:
 *           type: string
 *           example: "500 GB"
 *         os:
 *           type: string
 *           example: "Linux (Ubuntu / RHEL / Debian)"
 *         environment:
 *           type: string
 *           example: "Production"
 *         gpu:
 *           type: string
 *           description: '"None" when the server has no GPU'
 *           example: "None"
 *         status:
 *           type: string
 *           enum: [Active, Maintenance, Not Active]
 *           example: "Active"
 *         assignedProjects:
 *           type: array
 *           description: Project names (stored as names, not ids)
 *           items: { type: string }
 *           example: ["Ahana WPT", "Department Rating"]
 *         description:
 *           type: string
 *           example: "Primary application server"
 *     ServerInput:
 *       type: object
 *       required: [serverName, ipAddress, os, environment, status, assignedProjects]
 *       properties:
 *         serverName:
 *           type: string
 *           maxLength: 100
 *           example: "server1"
 *         ipAddress:
 *           type: string
 *           description: Valid IPv4 or IPv6 address
 *           example: "10.24.168.105"
 *         ram:
 *           type: string
 *           example: "32GB"
 *         cpu:
 *           type: string
 *           example: "8 core"
 *         storage:
 *           type: string
 *           example: "500 GB"
 *         gpu:
 *           type: string
 *           description: Leave empty or send "None" for no GPU
 *           example: "None"
 *         os:
 *           type: string
 *           description: Must be one of `operatingSystems` from GET /servers/options
 *           example: "Linux (Ubuntu / RHEL / Debian)"
 *         environment:
 *           type: string
 *           description: Must be one of `environments` from GET /servers/options
 *           example: "Production"
 *         status:
 *           type: string
 *           description: Must be one of `statuses` from GET /servers/options
 *           example: "Active"
 *         assignedProjects:
 *           type: array
 *           minItems: 1
 *           description: Project names. Names that are not in PMS (the "Other" option) are accepted as typed.
 *           items: { type: string }
 *           example: ["Ahana WPT", "My Custom Project"]
 *         description:
 *           type: string
 *           example: "Primary application server"
 */

/**
 * @swagger
 * /servers/options:
 *   get:
 *     summary: Dropdown options for the Add / Edit Server form
 *     description: |
 *       Environment, Initial Status and Operating System lists are constants
 *       in the backend (`src/constants/server.js`), so they can change
 *       without a frontend deploy. `defaults` are the pre-selected values
 *       for a new server.
 *     tags: [Servers]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Options retrieved successfully
 *         content:
 *           application/json:
 *             example:
 *               environments: ["Production", "UAT", "QA", "Development"]
 *               statuses: ["Active", "Maintenance", "Not Active"]
 *               operatingSystems: ["Linux (Ubuntu / RHEL / Debian)", "Ubuntu 22.04 LTS", "Windows Server 2022"]
 *               defaults:
 *                 operatingSystem: "Linux (Ubuntu / RHEL / Debian)"
 *                 environment: "Production"
 *                 status: "Active"
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 */

/**
 * @swagger
 * /servers/projects:
 *   get:
 *     summary: Allocated Projects options
 *     description: |
 *       Unique project titles from PMS `getAllProjects`, sorted. Only PMS projects are listed; custom names typed through "Other" are not added.
 *       No status filter is applied yet. If PMS cannot be reached the list is empty
 *       and `pmsError` holds the reason.
 *     tags: [Servers]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Projects retrieved successfully
 *         content:
 *           application/json:
 *             example:
 *               projects: ["Ahana WPT", "Department Rating"]
 *               pmsError: null
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */

/**
 * @swagger
 * /servers/assigned-projects:
 *   get:
 *     summary: Projects actually assigned to a server (merged into the list's Filter popup)
 *     description: |
 *       Distinct project names pulled from server_info.assigned_projects across active servers —
 *       NOT the full PMS catalog (see /servers/projects for that). This exists for custom names
 *       typed through "Other (Add Project)" on Add/Edit Server, which are never in PMS and so
 *       never appear in /servers/projects. The Filter popup's "Assign Project" options are the
 *       union of this and /servers/projects. No PMS call involved here.
 *     tags: [Servers]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Projects retrieved successfully
 *         content:
 *           application/json:
 *             example:
 *               projects: ["Ahana WPT", "Department Rating"]
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */

/**
 * @swagger
 * /servers:
 *   get:
 *     summary: List servers (Server Information main page)
 *     description: Paged list, most recently updated first.
 *     tags: [Servers]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: pageSize
 *         schema: { type: integer, default: 10 }
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *         description: Matches server name, IP address, OS, environment or assigned project
 *         example: "10.24"
 *     responses:
 *       200:
 *         description: Servers retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 content:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Server'
 *                 totalElements: { type: integer, example: 1 }
 *                 totalPages: { type: integer, example: 1 }
 *                 page: { type: integer, example: 1 }
 *                 activeCount:
 *                   type: integer
 *                   description: Servers with status "Active" (the "Active Hosts" badge)
 *                   example: 1
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 *
 *   post:
 *     summary: Add a server
 *     tags: [Servers]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ServerInput'
 *     responses:
 *       201:
 *         description: Server created
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Server'
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             examples:
 *               name:
 *                 value: { message: "Server name is required" }
 *               ip:
 *                 value: { message: "IP address is not valid" }
 *               os:
 *                 value: { message: "Operating system is not a valid option" }
 *               projects:
 *                 value: { message: "At least one project must be assigned" }
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */

/**
 * @swagger
 * /servers/{id}:
 *   get:
 *     summary: Get one server (Edit Server pre-fill)
 *     tags: [Servers]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *         example: 1
 *     responses:
 *       200:
 *         description: Server retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Server'
 *       404:
 *         description: Server not found
 *         content:
 *           application/json:
 *             example: { message: "Server not found" }
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 *
 *   put:
 *     summary: Update a server
 *     description: Same body and validation as Add. Replaces all editable fields.
 *     tags: [Servers]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *         example: 1
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ServerInput'
 *     responses:
 *       200:
 *         description: Server updated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Server'
 *       400:
 *         description: Validation error (same messages as Add)
 *         content:
 *           application/json:
 *             example: { message: "Environment is required" }
 *       404:
 *         description: Server not found
 *         content:
 *           application/json:
 *             example: { message: "Server not found" }
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
