const express = require("express");
const router = express.Router();

const { authMiddleware } = require("../middleware/auth.middleware");
const {
  getProjectDocumentChecklist,
} = require("../controller/projectDocumentChecklist.controller");

// GET /api/project-document-checklist   page, pageSize, search (project name), status
router.get("/", authMiddleware, getProjectDocumentChecklist);

module.exports = router;

/**
 * @swagger
 * tags:
 *   - name: Project Document Checklist
 *     description: Report of the 16 fixed documents for every imported project
 */

/**
 * @swagger
 * /project-document-checklist:
 *   get:
 *     summary: Project Document Checklist report
 *     description: |
 *       Built from existing tables, no table of its own. Covers every
 *       imported project (`project_info`); a document counts as Available
 *       when its `document_checklist` row has a SharePoint link. Project
 *       name and status are read live from PMS `getAllProjects` (falls back
 *       to the stored title, and a null status, if PMS fails).
 *
 *       - `summary` covers all imported projects and ignores search/status.
 *       - Each project lists the 16 fixed documents, then any custom documents added
 *         with "Add Document" (`custom: true`, always Available). Custom documents count in
 *         received / total / compliance, e.g. 2 of 17.
 *       - Compliance is received / total per project, and uploaded / all documents overall.
 *       - Needs the cached PMS session, like the Projects list.
 *     tags: [Project Document Checklist]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: pageSize
 *         schema: { type: integer, default: 10, maximum: 100 }
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *         description: Project name only
 *         example: "FMS"
 *       - in: query
 *         name: status
 *         schema: { type: string }
 *         description: Exact PMS project status (see `statuses` in the response)
 *         example: "In Progress"
 *     responses:
 *       200:
 *         description: Report retrieved successfully
 *         content:
 *           application/json:
 *             example:
 *               summary:
 *                 totalProjects: 8
 *                 uploadedDocuments: 8
 *                 pendingDocuments: 120
 *                 complianceRate: 6.3
 *               content:
 *                 - id: 7
 *                   name: "FMS Implementation"
 *                   code: "PRJ-9021"
 *                   status: "In Progress"
 *                   received: 12
 *                   pending: 4
 *                   total: 17
 *                   compliance: 75
 *                   documents:
 *                     - { id: 1, name: "BRD or CR", available: true }
 *                     - { id: 10, name: "QA signoff", available: false }
 *                     - { id: "custom-1", name: "Figma Doc", available: true, custom: true }
 *               totalElements: 8
 *               totalPages: 1
 *               page: 1
 *               statuses: ["Completed", "In Progress"]
 *       401:
 *         description: Unauthorized, or no cached PMS session
 *         content:
 *           application/json:
 *             example:
 *               message: "PMS session not found or expired. Please log in again to refresh your PMS access."
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
