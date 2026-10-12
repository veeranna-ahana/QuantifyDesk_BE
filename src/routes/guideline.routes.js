const express = require("express");
const router = express.Router();

const { authMiddleware } = require("../middleware/auth.middleware");
const {
  getGuidelines,
  getGuidelineById,
  createGuideline,
  updateGuideline,
} = require("../controller/guideline.controller");

// GET  /api/guidelines            list (page, pageSize, search, versions, lastUpdated)
// GET  /api/guidelines/:id        one guideline (Edit Guideline pre-fill)
// POST /api/guidelines            create
// PUT  /api/guidelines/:id        update
router.get("/", authMiddleware, getGuidelines);
router.get("/:id", authMiddleware, getGuidelineById);
router.post("/", authMiddleware, createGuideline);
router.put("/:id", authMiddleware, updateGuideline);

module.exports = router;

/**
 * @swagger
 * tags:
 *   - name: Guidelines
 *     description: Guideline documents - list, view, add and edit
 *
 * components:
 *   schemas:
 *     Guideline:
 *       type: object
 *       properties:
 *         id:
 *           type: integer
 *           example: 4
 *         name:
 *           type: string
 *           example: "Coding Standards"
 *         link:
 *           type: string
 *           example: "https://docs.example.com/coding-standards"
 *         version:
 *           type: string
 *           example: "v1.2"
 *         ownerName:
 *           type: string
 *           example: "Kusum G G"
 *         scope:
 *           type: string
 *           description: Scope & Objectives
 *           example: "Applies to all backend and frontend code."
 *         createdDate:
 *           type: string
 *           example: "2026-10-01"
 *         lastUpdated:
 *           type: string
 *           example: "2026-10-09"
 *     GuidelineInput:
 *       type: object
 *       required: [name, link, version, scope]
 *       properties:
 *         name:
 *           type: string
 *           maxLength: 100
 *           example: "Coding Standards"
 *         link:
 *           type: string
 *           maxLength: 1000
 *           description: Must be a valid URL; "https://" is added when missing
 *           example: "docs.example.com/coding-standards"
 *         version:
 *           type: string
 *           maxLength: 20
 *           example: "v1.2"
 *         ownerName:
 *           type: string
 *           maxLength: 150
 *           description: Optional, never auto-filled
 *           example: "Kusum G G"
 *         scope:
 *           type: string
 *           example: "Applies to all backend and frontend code."
 */

/**
 * @swagger
 * /guidelines:
 *   get:
 *     summary: List guidelines (Guideline main page)
 *     description: |
 *       Paged list, newest update first. Supports search, version filter
 *       and a last-updated filter. The page number is clamped to the last
 *       page when it is too large.
 *     tags: [Guidelines]
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
 *         description: Matches guideline name or owner name
 *         example: "coding"
 *       - in: query
 *         name: versions
 *         schema: { type: string }
 *         description: Comma-separated versions
 *         example: "v1.0,v1.2"
 *       - in: query
 *         name: lastUpdated
 *         schema:
 *           type: string
 *           enum: [all, 7d, 30d]
 *           default: all
 *     responses:
 *       200:
 *         description: Guidelines retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 content:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Guideline'
 *                 totalElements:
 *                   type: integer
 *                   description: Rows matching the current search and filters
 *                   example: 12
 *                 totalDocuments:
 *                   type: integer
 *                   description: All active guidelines, ignoring search and filters
 *                   example: 25
 *                 totalPages:
 *                   type: integer
 *                   example: 2
 *                 page:
 *                   type: integer
 *                   example: 1
 *                 versions:
 *                   type: array
 *                   description: Every version in use (for the filter dropdown)
 *                   items: { type: string }
 *                   example: ["v1.0", "v1.1", "v1.2"]
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 *
 *   post:
 *     summary: Add a guideline
 *     tags: [Guidelines]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/GuidelineInput'
 *     responses:
 *       201:
 *         description: Guideline created
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Guideline'
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             examples:
 *               name:
 *                 value: { message: "Guideline name is required" }
 *               link:
 *                 value: { message: "Guideline link is not a valid URL" }
 *               version:
 *                 value: { message: "Version is required" }
 *               scope:
 *                 value: { message: "Scope & Objectives is required" }
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */

/**
 * @swagger
 * /guidelines/{id}:
 *   get:
 *     summary: Get one guideline (Edit Guideline pre-fill)
 *     tags: [Guidelines]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *         example: 4
 *     responses:
 *       200:
 *         description: Guideline retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Guideline'
 *       404:
 *         description: Guideline not found
 *         content:
 *           application/json:
 *             example: { message: "Guideline not found" }
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 *
 *   put:
 *     summary: Update a guideline
 *     description: Same body and validation as Add. Replaces all editable fields.
 *     tags: [Guidelines]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *         example: 4
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/GuidelineInput'
 *     responses:
 *       200:
 *         description: Guideline updated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Guideline'
 *       400:
 *         description: Validation error (same messages as Add)
 *         content:
 *           application/json:
 *             example: { message: "Guideline link is required" }
 *       404:
 *         description: Guideline not found
 *         content:
 *           application/json:
 *             example: { message: "Guideline not found" }
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
