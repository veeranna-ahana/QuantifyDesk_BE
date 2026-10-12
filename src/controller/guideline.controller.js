const { query } = require("../config/db");

// ============================================================================
// Guidelines — list (search / version filter / last-updated filter / paging),
// get one, create, update. Backed by the `guideline` table
// (sql/2026_10_guideline.sql). Rows are soft-deleted via is_active = 0.
// ============================================================================

const DEFAULT_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 100;

const LIMITS = { name: 100, link: 1000, version: 20, owner: 150 };

// Dates go out as plain YYYY-MM-DD strings (what the frontend's formatDate expects), computed
// by MySQL so the app server's timezone can't shift a day.
const SELECT_COLUMNS = `
  guideline_id            AS id,
  guideline_name          AS name,
  guideline_link          AS link,
  version,
  owner_name              AS ownerName,
  scope_objectives        AS scope,
  DATE_FORMAT(created_at, '%Y-%m-%d') AS createdDate,
  DATE_FORMAT(updated_at, '%Y-%m-%d') AS lastUpdated`;

/** Accepts "docs.x.io/a" or "https://docs.x.io/a"; returns a full http(s) URL or null if invalid. */
const normalizeLink = (raw) => {
  const value = String(raw ?? "").trim();
  if (!value) return null;
  const withProtocol = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  try {
    const u = new URL(withProtocol);
    if (!u.hostname.includes(".")) return null;
    return withProtocol;
  } catch {
    return null;
  }
};

/** Validates + cleans the request body. Returns { error } or { value }. */
const parseBody = (body = {}) => {
  const name = String(body.name ?? "").trim();
  const version = String(body.version ?? "").trim();
  const ownerName = String(body.ownerName ?? "").trim();
  const scope = String(body.scope ?? "").trim();
  const link = normalizeLink(body.link);

  if (!name) return { error: "Guideline name is required" };
  if (name.length > LIMITS.name)
    return {
      error: `Guideline name must be at most ${LIMITS.name} characters`,
    };
  if (!String(body.link ?? "").trim())
    return { error: "Guideline link is required" };
  if (!link) return { error: "Guideline link is not a valid URL" };
  if (link.length > LIMITS.link) return { error: "Guideline link is too long" };
  if (!version) return { error: "Version is required" };
  if (version.length > LIMITS.version)
    return { error: `Version must be at most ${LIMITS.version} characters` };
  if (ownerName.length > LIMITS.owner)
    return { error: `Owner name must be at most ${LIMITS.owner} characters` };
  if (!scope) return { error: "Scope & Objectives is required" };

  return { value: { name, link, version, ownerName, scope } };
};

const escapeLike = (s) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

// GET /api/guidelines?page=1&pageSize=10&search=&versions=v1.0,v1.1&lastUpdated=all|7d|30d
const getGuidelines = async (req, res, next) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const pageSize = Math.min(
      Math.max(parseInt(req.query.pageSize, 10) || DEFAULT_PAGE_SIZE, 1),
      MAX_PAGE_SIZE,
    );
    const search = String(req.query.search ?? "")
      .trim()
      .replace(/\s+/g, " ");
    const versions = String(req.query.versions ?? "")
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);
    const days = { "7d": 7, "30d": 30 }[req.query.lastUpdated] || null;

    const where = ["is_active = 1"];
    const params = [];

    if (search) {
      where.push("(guideline_name LIKE ? OR owner_name LIKE ?)");
      const like = `%${escapeLike(search)}%`;
      params.push(like, like);
    }
    if (versions.length) {
      // one placeholder per value — prepared statements can't bind an array to a single IN (?)
      where.push(`version IN (${versions.map(() => "?").join(",")})`);
      params.push(...versions);
    }
    if (days) {
      where.push("updated_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)");
      params.push(days);
    }
    const whereSql = where.join(" AND ");

    const [{ total }] = await query(
      `SELECT COUNT(*) AS total FROM guideline WHERE ${whereSql}`,
      params,
    );
    const totalElements = Number(total);
    const totalPages = Math.max(1, Math.ceil(totalElements / pageSize));
    const currentPage = Math.min(page, totalPages);
    const offset = (currentPage - 1) * pageSize;

    // LIMIT/OFFSET are integers we computed above (never user text), so they're safe to inline;
    // mysql2's execute() is picky about binding numbers to LIMIT.
    const content = await query(
      `SELECT ${SELECT_COLUMNS}
         FROM guideline
        WHERE ${whereSql}
        ORDER BY updated_at DESC, guideline_id DESC
        LIMIT ${pageSize} OFFSET ${offset}`,
      params,
    );

    const [{ totalDocuments }] = await query(
      `SELECT COUNT(*) AS totalDocuments FROM guideline WHERE is_active = 1`,
    );
    const versionRows = await query(
      `SELECT DISTINCT version FROM guideline WHERE is_active = 1`,
    );
    const allVersions = versionRows
      .map((r) => r.version)
      .sort((a, b) =>
        a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }),
      );

    return res.status(200).json({
      content,
      totalElements,
      totalDocuments: Number(totalDocuments),
      totalPages,
      page: currentPage,
      versions: allVersions,
    });
  } catch (err) {
    return next(err);
  }
};

// GET /api/guidelines/:id
const getGuidelineById = async (req, res, next) => {
  try {
    const rows = await query(
      `SELECT ${SELECT_COLUMNS} FROM guideline WHERE guideline_id = ? AND is_active = 1`,
      [req.params.id],
    );
    if (rows.length === 0)
      return res.status(404).json({ message: "Guideline not found" });
    return res.status(200).json(rows[0]);
  } catch (err) {
    return next(err);
  }
};

// POST /api/guidelines
const createGuideline = async (req, res, next) => {
  try {
    const { error, value } = parseBody(req.body);
    if (error) return res.status(400).json({ message: error });

    const empId = req.user?.emp_id || null;
    const result = await query(
      `INSERT INTO guideline
         (guideline_name, guideline_link, version, owner_name, scope_objectives,
          owner_emp_id, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        value.name,
        value.link,
        value.version,
        value.ownerName || "—",
        value.scope,
        empId,
        empId,
        empId,
      ],
    );

    const rows = await query(
      `SELECT ${SELECT_COLUMNS} FROM guideline WHERE guideline_id = ?`,
      [result.insertId],
    );
    return res.status(201).json(rows[0]);
  } catch (err) {
    return next(err);
  }
};

// PUT /api/guidelines/:id
const updateGuideline = async (req, res, next) => {
  try {
    const { error, value } = parseBody(req.body);
    if (error) return res.status(400).json({ message: error });

    const result = await query(
      `UPDATE guideline
          SET guideline_name = ?, guideline_link = ?, version = ?, owner_name = ?,
              scope_objectives = ?, updated_by = ?
        WHERE guideline_id = ? AND is_active = 1`,
      [
        value.name,
        value.link,
        value.version,
        value.ownerName || "—",
        value.scope,
        req.user?.emp_id || null,
        req.params.id,
      ],
    );
    if (result.affectedRows === 0)
      return res.status(404).json({ message: "Guideline not found" });

    const rows = await query(
      `SELECT ${SELECT_COLUMNS} FROM guideline WHERE guideline_id = ?`,
      [req.params.id],
    );
    return res.status(200).json(rows[0]);
  } catch (err) {
    return next(err);
  }
};

module.exports = {
  getGuidelines,
  getGuidelineById,
  createGuideline,
  updateGuideline,
};
