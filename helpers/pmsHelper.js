const axios = require('axios');

// ─────────────────────────────────────────────────────────────────────────────
// PMS Helper
// Centralizes all PMS API communication (base URL, auth header forwarding,
// timeouts, error normalization). Use from any controller that proxies PMS.
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_TIMEOUT = 30000;

/**
 * Build headers for a PMS request.
 * Forwards the incoming Authorization header (main portal SSO token) verbatim.
 *
 * @param {object} req - Express request object
 * @returns {object} headers
 */
function getPMSHeaders(req) {
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };

  const authHeader = req.headers?.authorization;

  if (authHeader) {
    headers['Authorization'] = authHeader;
  } else {
    console.warn('⚠️ PMS Helper: No authorization header found in request');
  }

  return headers;
}

/**
 * Get the PMS base URL from .env. Throws if missing.
 *
 * @returns {string}
 */
function getPMSBaseUrl() {
  const baseUrl = process.env.PMS_BASE_URL;
  if (!baseUrl) {
    throw new Error('PMS_BASE_URL is not configured in environment');
  }
  return baseUrl;
}

/**
 * Generic PMS GET call. Builds URL from a path and optional query params,
 * forwards the incoming auth header, and returns response.data.
 *
 * @param {object} req - Express request object (for headers)
 * @param {string} path - PMS path starting with '/', e.g. '/api/pms/foo'
 * @param {object} [query] - Optional query params
 * @param {object} [options] - { timeout }
 * @returns {Promise<any>} PMS response data
 */
async function pmsGet(req, path, query = {}, options = {}) {
  const baseUrl = getPMSBaseUrl();
  const url = `${baseUrl}${path}`;
  const headers = getPMSHeaders(req);
  const timeout = options.timeout ?? DEFAULT_TIMEOUT;

  console.log('📡 PMS GET:', url);

  const response = await axios.get(url, {
    headers,
    params: query,
    timeout,
  });

  return response.data;
}

/**
 * Generic PMS POST call.
 *
 * @param {object} req - Express request object
 * @param {string} path - PMS path starting with '/'
 * @param {object} [body] - Request body
 * @param {object} [options] - { timeout }
 * @returns {Promise<any>} PMS response data
 */
async function pmsPost(req, path, body = {}, options = {}) {
  const baseUrl = getPMSBaseUrl();
  const url = `${baseUrl}${path}`;
  const headers = getPMSHeaders(req);
  const timeout = options.timeout ?? DEFAULT_TIMEOUT;

  console.log('📡 PMS POST:', url);

  const response = await axios.post(url, body, {
    headers,
    timeout,
  });

  return response.data;
}

/**
 * Normalize a PMS error into a shape suitable for sending to the client.
 *
 * @param {Error} err
 * @returns {{ status: number, body: object }}
 */
function normalizePMSError(err) {
  // Error returned by PMS (has err.response)
  if (err.response) {
    const status = err.response.status;
    const pmsData = err.response.data || {};

    if (status === 401) {
      return {
        status: 401,
        body: {
          success: false,
          message: 'Authentication failed with PMS API',
          error: pmsData.message || 'Invalid or expired token',
        },
      };
    }

    if (status === 403) {
      return {
        status: 403,
        body: {
          success: false,
          message: 'Access denied by PMS API',
          error: pmsData.message || 'Forbidden',
        },
      };
    }

    if (status === 404) {
      return {
        status: 404,
        body: {
          success: false,
          message: 'Resource not found in PMS',
          error: pmsData.message || 'Not found',
        },
      };
    }

    return {
      status,
      body: {
        success: false,
        message: 'PMS API error',
        error: pmsData.message || pmsData || 'Unknown PMS error',
      },
    };
  }

  // Timeout / network error
  if (err.code === 'ECONNABORTED') {
    return {
      status: 504,
      body: {
        success: false,
        message: 'PMS request timed out',
        error: err.message,
      },
    };
  }

  if (err.code === 'ENOTFOUND' || err.code === 'ECONNREFUSED') {
    return {
      status: 503,
      body: {
        success: false,
        message: 'PMS is unreachable',
        error: err.message,
      },
    };
  }

  // Config errors (e.g., missing PMS_BASE_URL) or unknown
  return {
    status: 500,
    body: {
      success: false,
      message: 'Failed to communicate with PMS',
      error: err.message,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// PMS Response Normalizers & Task Utilities
// ─────────────────────────────────────────────────────────────────────────────

/**
 * PMS wraps project arrays in different shapes across endpoints.
 * Normalizes to a plain array.
 *
 * Handles:
 *   [ ... ]                          → array
 *   { data: { projects: [...] } }    → /getAllProjects shape
 *   { data: [...] }                  → generic wrapper
 *   { projects: [...] }              → flat wrapper
 */
function extractProjects(raw) {
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw?.data?.projects)) return raw.data.projects;
  if (Array.isArray(raw?.data)) return raw.data;
  if (Array.isArray(raw?.projects)) return raw.projects;
  return [];
}

/**
 * Parse a date-like value into a Date object (or null).
 */
const toDate = (v) => (v ? new Date(v) : null);

/**
 * Shape a raw PMS task into a stable task object.
 */
function shapeTask(t, meta) {
  return {
    task_id: t.task_id,
    task_title: t.task_title,
    task_uuid: t.task_uuid,
    status: t.status,
    emp_id: t.emp_id,
    emp_name: t.emp_name,
    planned_start_date: t.planned_start_date,
    planned_end_date: t.planned_end_date,
    actual_start_date: t.actual_start_date,
    actual_end_date: t.actual_end_date,
    project_milestone_id: t.project_milestone_id,

    role: meta?.role ?? null,
    task_type: meta?.task_type ?? null,
    unit: meta?.unit ?? null,
  };
}

/**
 * A task is "delayed" if its actual_end_date is after its planned_end_date.
 */
function isDelayed(t) {
  const planned = toDate(t.planned_end_date);
  const actual = toDate(t.actual_end_date);
  if (!planned || !actual) return false;
  return actual.getTime() > planned.getTime();
}

/**
 * Extract `tasksDetails` and `milestoneDetails` from a PMS
 * /getProjectDetails response, handling nested shapes.
 */
function extractProjectDetails(raw) {
  const tasks = Array.isArray(raw?.tasksDetails)
    ? raw.tasksDetails
    : Array.isArray(raw?.data?.tasksDetails)
      ? raw.data.tasksDetails
      : [];

  const milestones = Array.isArray(raw?.milestoneDetails)
    ? raw.milestoneDetails
    : Array.isArray(raw?.data?.milestoneDetails)
      ? raw.data.milestoneDetails
      : [];

  return { tasks, milestones };
}
module.exports = {
  getPMSHeaders,
  getPMSBaseUrl,
  pmsGet,
  pmsPost,
  normalizePMSError,
extractProjects,
  extractProjectDetails,
  toDate,
  shapeTask,
  isDelayed,
};