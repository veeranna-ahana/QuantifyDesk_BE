const { query } = require("../config/db");
const { getUatToken } = require("../../helpers/pmsTokenStore");
const { pmsGet, extractProjects } = require("../../helpers/pmsHelper");

// ============================================================================
// Project Document Checklist report — every imported project with its 16 fixed documents
// (document_master) marked Available / Not Available. No table of its own: it is built from
//   project_info          which projects were imported (+ project code, stored title)
//   document_master       the 16 document types
//   document_checklist    a document is "Available" when its row has a SharePoint link
//   PMS getAllProjects    live project name and status (PMS-owned, never stored)
// Custom documents added with "Add Document" (document_id NULL, name in custom_document_name) are
// listed after the 16 and counted in Received / Pending / Compliance, same as the project's own
// Documents Checklist tab ("2 of 17 documents uploaded").
// ============================================================================

const DEFAULT_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 100;

const percent = (part, whole, decimals = 0) => {
  if (!whole) return 0;
  const factor = 10 ** decimals;
  return Math.round((part / whole) * 100 * factor) / factor;
};

// GET /api/project-document-checklist?page=1&pageSize=10&search=&status=
const getProjectDocumentChecklist = async (req, res, next) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const pageSize = Math.min(
      Math.max(parseInt(req.query.pageSize, 10) || DEFAULT_PAGE_SIZE, 1),
      MAX_PAGE_SIZE,
    );
    const search = String(req.query.search ?? "")
      .trim()
      .toLowerCase();
    const status = String(req.query.status ?? "").trim();

    const uatToken = getUatToken(req.user?.emp_id);
    if (!uatToken) {
      return res.status(401).json({
        message:
          "PMS session not found or expired. Please log in again to refresh your PMS access.",
      });
    }

    const [projectRows, masterDocs, linkRows, customRows] = await Promise.all([
      query(
        `SELECT project_info_id, project_id, project_title, project_code
           FROM project_info
          ORDER BY project_info_id DESC`,
      ),
      query(
        `SELECT document_id, document_name FROM document_master ORDER BY document_id ASC`,
      ),
      query(
        `SELECT project_info_id, document_id
           FROM document_checklist
          WHERE document_id IS NOT NULL
            AND sharepoint_url IS NOT NULL AND sharepoint_url <> ''`,
      ),
      query(
        `SELECT project_info_id, custom_document_name
           FROM document_checklist
          WHERE document_id IS NULL AND custom_document_name IS NOT NULL
            AND sharepoint_url IS NOT NULL AND sharepoint_url <> ''
          ORDER BY uploaded_date ASC`,
      ),
    ]);

    // One PMS call for every project's live name/status; if it fails we fall back to the title
    // stored at import time and no status.
    let pmsProjects = [];
    try {
      pmsProjects = extractProjects(
        await pmsGet(uatToken, "/api/pms/getAllProjects"),
      );
    } catch (pmsErr) {
      console.error("Document checklist: PMS fetch failed:", pmsErr.message);
    }
    const pmsById = new Map(
      pmsProjects.map((p) => [String(p.project_id || p.id), p]),
    );

    const linked = new Map(); // project_info_id -> Set(document_id)
    for (const { project_info_id, document_id } of linkRows) {
      if (!linked.has(project_info_id)) linked.set(project_info_id, new Set());
      linked.get(project_info_id).add(document_id);
    }

    const customByProject = new Map(); // project_info_id -> [custom document names]
    for (const { project_info_id, custom_document_name } of customRows) {
      if (!customByProject.has(project_info_id))
        customByProject.set(project_info_id, []);
      customByProject.get(project_info_id).push(custom_document_name);
    }

    const all = projectRows.map((row) => {
      const pms = pmsById.get(String(row.project_id));
      const have = linked.get(row.project_info_id) || new Set();
      const documents = [
        ...masterDocs.map((d) => ({
          id: d.document_id,
          name: d.document_name,
          available: have.has(d.document_id),
          custom: false,
        })),
        ...(customByProject.get(row.project_info_id) || []).map((name, i) => ({
          id: `custom-${i + 1}`,
          name,
          available: true,
          custom: true,
        })),
      ];
      const total = documents.length;
      const received = documents.filter((d) => d.available).length;
      return {
        id: row.project_info_id,
        name: pms?.project_title || pms?.title || row.project_title || "—",
        code: row.project_code || "",
        status: pms?.status || null,
        received,
        pending: total - received,
        total,
        compliance: percent(received, total),
        documents,
      };
    });

    // Summary cards cover every imported project, whatever the search/filter
    const uploadedDocuments = all.reduce((sum, p) => sum + p.received, 0);
    const allDocuments = all.reduce((sum, p) => sum + p.total, 0);
    const summary = {
      totalProjects: all.length,
      uploadedDocuments,
      pendingDocuments: allDocuments - uploadedDocuments,
      complianceRate: percent(uploadedDocuments, allDocuments, 1),
    };

    const statuses = [
      ...new Set(all.map((p) => p.status).filter(Boolean)),
    ].sort((a, b) => a.localeCompare(b));

    const filtered = all.filter(
      (p) =>
        (!search || p.name.toLowerCase().includes(search)) &&
        (!status || p.status === status),
    );
    const totalElements = filtered.length;
    const totalPages = Math.max(1, Math.ceil(totalElements / pageSize));
    const currentPage = Math.min(page, totalPages);
    const offset = (currentPage - 1) * pageSize;

    return res.status(200).json({
      summary,
      content: filtered.slice(offset, offset + pageSize),
      totalElements,
      totalPages,
      page: currentPage,
      statuses,
    });
  } catch (err) {
    return next(err);
  }
};

module.exports = { getProjectDocumentChecklist };
