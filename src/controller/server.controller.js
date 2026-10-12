const net = require("net");

const { query } = require("../config/db");
const { getUatToken } = require("../../helpers/pmsTokenStore");
const {
  pmsGet,
  extractProjects,
  normalizePMSError,
} = require("../../helpers/pmsHelper");
const {
  ENVIRONMENTS,
  SERVER_STATUSES,
  OPERATING_SYSTEMS,
  SERVER_DEFAULTS,
} = require("../constants/server");

// ============================================================================
// Server Information — list, get one, create, update, plus the dropdown data the
// Add / Edit Server form needs. One table: server_info (sql/2026_10_server_information.sql).
// Rows are soft-deleted via is_active = 0.
//
// Project options are the unique titles from PMS (getAllProjects) plus any name already used on a
// server, which is how a name typed in through "Other (Add Project)" becomes a normal option next
// time. A server keeps its project names in server_info.assigned_projects as a JSON array text,
// e.g. ["FMS Project","WPT Project"] — no separate project table.
// ============================================================================

const DEFAULT_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 100;
const LIMITS = {
  name: 100,
  ip: 45,
  ram: 50,
  cpu: 100,
  storage: 100,
  gpu: 100,
  project: 100,
  description: 5000,
};

const escapeLike = (s) => s.replace(/[\\%_]/g, (c) => `\\${c}`);
const clean = (v) =>
  String(v ?? "")
    .trim()
    .replace(/\s+/g, " ");

// ── PMS project titles ─────────────────────────────────────────────────────
// Unique titles from PMS's getAllProjects (same call/dedupe as Import Project's title
// dropdown). Whether to filter by project status is still undecided, so nothing is filtered.
const fetchPmsProjectTitles = async (empId) => {
  const uatToken = getUatToken(empId);
  if (!uatToken) {
    const err = new Error(
      "PMS session not found or expired. Please log in again to refresh your PMS access.",
    );
    err.pmsSession = true;
    throw err;
  }
  const raw = await pmsGet(uatToken, "/api/pms/getAllProjects");
  const titles = extractProjects(raw)
    .map((p) => clean(p.project_title))
    .filter(Boolean);
  return [...new Set(titles)].sort((a, b) => a.localeCompare(b));
};

// GET /api/servers/options — Environment / Initial Status / Operating System dropdowns
const getServerOptions = (req, res) =>
  res.status(200).json({
    environments: ENVIRONMENTS,
    statuses: SERVER_STATUSES,
    operatingSystems: OPERATING_SYSTEMS,
    defaults: SERVER_DEFAULTS,
  });

const parseProjects = (text) => {
  try {
    const arr = JSON.parse(text || "[]");
    return Array.isArray(arr)
      ? arr.filter((n) => typeof n === "string" && n)
      : [];
  } catch {
    return [];
  }
};

// GET /api/servers/projects — "Allocated Projects" options: the unique project titles from PMS,
// nothing else. Custom names typed through "Other" belong to that server only and are never
// added to this list. If PMS can't be reached the list is empty and `pmsError` says why.
const getServerProjects = async (req, res, next) => {
  try {
    let projects = [];
    let pmsError = null;
    try {
      projects = await fetchPmsProjectTitles(req.user?.emp_id);
    } catch (err) {
      pmsError = err.pmsSession
        ? err.message
        : normalizePMSError(err).body?.message ||
          "Could not load PMS projects.";
      console.error("Server projects: PMS fetch failed:", err.message);
    }
    return res.status(200).json({ projects, pmsError });
  } catch (err) {
    return next(err);
  }
};

// ── Validation ─────────────────────────────────────────────────────────────
const parseBody = (body = {}) => {
  const serverName = clean(body.serverName);
  const ipAddress = String(body.ipAddress ?? "").trim();
  const ram = clean(body.ram);
  const cpu = clean(body.cpu);
  const storage = clean(body.storage);
  const gpuRaw = clean(body.gpu);
  const gpu = !gpuRaw || gpuRaw.toLowerCase() === "none" ? "" : gpuRaw;
  const os = String(body.os ?? "").trim();
  const environment = String(body.environment ?? "").trim();
  const status = String(body.status ?? "").trim();
  const description = String(body.description ?? "").trim();

  const names = [];
  const seen = new Set();
  for (const raw of Array.isArray(body.assignedProjects)
    ? body.assignedProjects
    : []) {
    const n = clean(raw);
    if (n && !seen.has(n.toLowerCase())) {
      seen.add(n.toLowerCase());
      names.push(n);
    }
  }

  if (!serverName) return { error: "Server name is required" };
  if (serverName.length > LIMITS.name)
    return { error: `Server name must be at most ${LIMITS.name} characters` };
  if (!ipAddress) return { error: "IP address is required" };
  if (net.isIP(ipAddress) === 0) return { error: "IP address is not valid" };
  if (ram.length > LIMITS.ram)
    return { error: `RAM must be at most ${LIMITS.ram} characters` };
  if (cpu.length > LIMITS.cpu)
    return { error: `CPU must be at most ${LIMITS.cpu} characters` };
  if (storage.length > LIMITS.storage)
    return { error: `Storage must be at most ${LIMITS.storage} characters` };
  if (gpu.length > LIMITS.gpu)
    return { error: `GPU must be at most ${LIMITS.gpu} characters` };
  if (!os) return { error: "Operating system is required" };
  if (!OPERATING_SYSTEMS.includes(os))
    return { error: "Operating system is not a valid option" };
  if (!environment) return { error: "Environment is required" };
  if (!ENVIRONMENTS.includes(environment))
    return { error: "Environment is not a valid option" };
  if (!status) return { error: "Initial status is required" };
  if (!SERVER_STATUSES.includes(status))
    return { error: "Initial status is not a valid option" };
  if (names.length === 0)
    return { error: "At least one project must be assigned" };
  if (names.some((n) => n.length > LIMITS.project))
    return {
      error: `Project names must be at most ${LIMITS.project} characters`,
    };
  if (description.length > LIMITS.description)
    return {
      error: `Description must be at most ${LIMITS.description} characters`,
    };

  return {
    value: {
      serverName,
      ipAddress,
      ram: ram || null,
      cpu: cpu || null,
      storage: storage || null,
      os,
      environment,
      gpu: gpu || null,
      status,
      description: description || null,
      projectNames: names,
    },
  };
};

// ── Row shaping ────────────────────────────────────────────────────────────
const SELECT_COLUMNS = `
  s.server_id                AS id,
  s.server_name              AS serverName,
  s.ip_address               AS ipAddress,
  s.ram,
  s.cpu,
  s.storage,
  s.os,
  s.environment,
  s.gpu,
  s.status,
  s.assigned_projects        AS assignedProjects,
  s.description`;

/** Turns the stored JSON text into `assignedProjects` (names) and fills blanks for display. */
const shapeRows = (rows) =>
  rows.map(
    ({ assignedProjects, gpu, ram, cpu, storage, description, ...r }) => ({
      ...r,
      ram: ram || "",
      cpu: cpu || "",
      storage: storage || "",
      gpu: gpu || "None",
      description: description || "",
      assignedProjects: parseProjects(assignedProjects),
    }),
  );

// GET /api/servers?page=1&pageSize=10&search=
const getServers = async (req, res, next) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const pageSize = Math.min(
      Math.max(parseInt(req.query.pageSize, 10) || DEFAULT_PAGE_SIZE, 1),
      MAX_PAGE_SIZE,
    );
    const search = clean(req.query.search);

    const where = ["s.is_active = 1"];
    const params = [];
    if (search) {
      const like = `%${escapeLike(search)}%`;
      where.push(`(
        s.server_name LIKE ? OR s.ip_address LIKE ? OR s.os LIKE ? OR s.environment LIKE ?
        OR s.assigned_projects LIKE ?
      )`);
      params.push(like, like, like, like, like);
    }
    const whereSql = where.join(" AND ");

    const [{ total }] = await query(
      `SELECT COUNT(*) AS total FROM server_info s WHERE ${whereSql}`,
      params,
    );
    const totalElements = Number(total);
    const totalPages = Math.max(1, Math.ceil(totalElements / pageSize));
    const currentPage = Math.min(page, totalPages);
    const offset = (currentPage - 1) * pageSize;

    // LIMIT / OFFSET are integers computed above (never user text), safe to inline.
    const rows = await query(
      `SELECT ${SELECT_COLUMNS}
         FROM server_info s
        WHERE ${whereSql}
        ORDER BY s.updated_at DESC, s.server_id DESC
        LIMIT ${pageSize} OFFSET ${offset}`,
      params,
    );

    const [{ activeCount }] = await query(
      `SELECT COUNT(*) AS activeCount FROM server_info
        WHERE is_active = 1 AND status = 'Active'`,
    );

    return res.status(200).json({
      content: shapeRows(rows),
      totalElements,
      totalPages,
      page: currentPage,
      activeCount: Number(activeCount),
    });
  } catch (err) {
    return next(err);
  }
};

const loadServer = async (id) => {
  const rows = await query(
    `SELECT ${SELECT_COLUMNS} FROM server_info s WHERE s.server_id = ? AND s.is_active = 1`,
    [id],
  );
  if (rows.length === 0) return null;
  const [server] = shapeRows(rows);
  // The edit form wants a blank GPU box, not the list's "None"
  return { ...server, gpu: server.gpu === "None" ? "" : server.gpu };
};

// GET /api/servers/:id
const getServerById = async (req, res, next) => {
  try {
    const server = await loadServer(req.params.id);
    if (!server) return res.status(404).json({ message: "Server not found" });
    return res.status(200).json(server);
  } catch (err) {
    return next(err);
  }
};

const saveServer = async (req, res, next, serverId) => {
  try {
    const { error, value } = parseBody(req.body);
    if (error) return res.status(400).json({ message: error });

    const empId = req.user?.emp_id || null;
    const projects = JSON.stringify(value.projectNames);
    const fields = [
      value.serverName,
      value.ipAddress,
      value.ram,
      value.cpu,
      value.storage,
      value.os,
      value.environment,
      value.gpu,
      value.status,
      projects,
      value.description,
    ];

    let id = serverId;
    if (serverId) {
      const result = await query(
        `UPDATE server_info
            SET server_name = ?, ip_address = ?, ram = ?, cpu = ?, storage = ?, os = ?,
                environment = ?, gpu = ?, status = ?, assigned_projects = ?,
                description = ?, updated_by = ?
          WHERE server_id = ? AND is_active = 1`,
        [...fields, empId, serverId],
      );
      if (result.affectedRows === 0)
        return res.status(404).json({ message: "Server not found" });
    } else {
      const result = await query(
        `INSERT INTO server_info
           (server_name, ip_address, ram, cpu, storage, os, environment, gpu, status,
            assigned_projects, description, created_by, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [...fields, empId, empId],
      );
      id = result.insertId;
    }

    return res.status(serverId ? 200 : 201).json(await loadServer(id));
  } catch (err) {
    return next(err);
  }
};

// POST /api/servers
const createServer = (req, res, next) => saveServer(req, res, next, null);

// PUT /api/servers/:id
const updateServer = (req, res, next) =>
  saveServer(req, res, next, req.params.id);

module.exports = {
  getServerOptions,
  getServerProjects,
  getServers,
  getServerById,
  createServer,
  updateServer,
};
