const { query } = require("../config/db");
const { fetchAllEmployeesFromHrms } = require("../../services/hrmsService");
const { getSkillsMap } = require("../../services/skillFinderService");
const { getUatToken } = require("../../helpers/pmsTokenStore");
const { calcExperienceYears } = require("../../helpers/experience");
const { pmsGet } = require("../../helpers/pmsHelper");
const {
  getEmployeePmsInfo,
  isEmployeeInfoCached,
} = require("../../helpers/employeePmsInfo");

// ─────────────────────────────────────────────────────────────────────────────
// Concurrency helper
// ─────────────────────────────────────────────────────────────────────────────
async function runWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let index = 0;

  async function next() {
    const i = index++;
    if (i >= items.length) return;
    try {
      results[i] = await worker(items[i], i);
    } catch (err) {
      results[i] = { error: err.message, item: items[i] };
    }
    return next();
  }

  const runners = Array.from({ length: Math.min(limit, items.length) }, next);
  await Promise.all(runners);
  return results;
}

const AVAILABILITY_CONCURRENCY = 8;

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/employees/delivery-details
// ─────────────────────────────────────────────────────────────────────────────
const getDeliveryEmployeeDetails = async (req, res) => {
  try {
    // ─── 1. HRMS employees ────────────────────────────────────────────────
    const allEmployees = await fetchAllEmployeesFromHrms();
    const deliveryEmployees = allEmployees.filter((e) => {
      const dept = String(e.Name_of_Department || "").trim();
      const status = String(e.Employee_Status || "").trim();
      return dept === "Delivery" && status === "Active";
    });

    if (deliveryEmployees.length === 0) {
      return res.status(200).json({ success: true, total: 0, employees: [] });
    }

    // ─── 2. Resolve UAT token ─────────────────────────────────────────────
    const uatToken =
      getUatToken(req.user?.emp_id) || process.env.PMS_SERVICE_TOKEN || null;

    if (!uatToken) {
      return res.status(401).json({
        success: false,
        message: "No PMS session found. Please log in again.",
      });
    }

    // ─── 3. Quantify DB: which projects each employee is on ──────────────
    const empIds = deliveryEmployees.map((e) => e.Employee_ID).filter(Boolean);
    const placeholders = empIds.map(() => "?").join(",");

    const projectRows = await query(
      `SELECT DISTINCT
         a.emp_id,
         pi.project_id     AS pms_project_id,
         pi.project_code   AS project_code
       FROM (
         SELECT emp_id, project_info_id FROM task_info
         UNION
         SELECT emp_id, project_info_id FROM effort_estimate
       ) a
       JOIN project_info pi ON pi.project_info_id = a.project_info_id
       WHERE a.emp_id IN (${placeholders})
       ORDER BY a.emp_id, pi.project_id`,
      empIds,
    );

    // ─── 4. Fetch PMS project titles (cached per pms_project_id) ─────────
    const projectTitleCache = new Map();

    async function getProjectTitle(pmsProjectId) {
      if (projectTitleCache.has(pmsProjectId)) {
        return projectTitleCache.get(pmsProjectId);
      }
      try {
        const raw = await pmsGet(uatToken, "/api/pms/getProjectDetails", {
          projectId: pmsProjectId,
        });
        const title = raw?.projectDetails?.project_title || null;
        projectTitleCache.set(pmsProjectId, title);
        return title;
      } catch (err) {
        console.warn(
          `⚠️ PMS fetch failed for project ${pmsProjectId}: ${err.message}`,
        );
        projectTitleCache.set(pmsProjectId, null);
        return null;
      }
    }

    const uniqueProjectIds = [
      ...new Set(projectRows.map((r) => r.pms_project_id)),
    ];
    console.log(
      `📡 Fetching PMS titles for ${uniqueProjectIds.length} unique project(s)`,
    );

    await runWithConcurrency(uniqueProjectIds, 3, getProjectTitle);

    // ─── 5. Build emp_id → [project_titles] map ──────────────────────────
    const projectsByEmp = new Map();
    for (const r of projectRows) {
      if (!projectsByEmp.has(r.emp_id)) projectsByEmp.set(r.emp_id, []);

      const title =
        projectTitleCache.get(r.pms_project_id) || // PMS title (preferred)
        r.project_code || // fallback: project code
        `Project ${r.pms_project_id}`; // last resort

      const list = projectsByEmp.get(r.emp_id);
      if (!list.includes(title)) list.push(title);
    }

    // ─── 6. Skill Finder: fetch full map once ────────────────────────────
    const skillsMap = await getSkillsMap(uatToken);
    // ─── 6b. Fetch PMS availability per employee (concurrency-limited) ────
    const pmsStart = Date.now();
    const cachedCount = deliveryEmployees.filter((e) =>
      isEmployeeInfoCached(e.Employee_ID),
    ).length;
    console.log(
      `📡 Fetching PMS availability/projects for ${deliveryEmployees.length - cachedCount} employee(s) (${cachedCount} cached)`,
    );

    const pmsInfoByEmp = new Map();

    await runWithConcurrency(
      deliveryEmployees,
      AVAILABILITY_CONCURRENCY,
      async (emp) => {
        pmsInfoByEmp.set(
          emp.Employee_ID,
          await getEmployeePmsInfo(uatToken, emp.Employee_ID),
        );
      },
    );
    console.log(
      `✅ PMS lookups done in ${Math.round((Date.now() - pmsStart) / 1000)}s`,
    );

    // ─── 7. Merge everything ─────────────────────────────────────────────
    const merged = deliveryEmployees.map((emp) => {
      const skills = skillsMap.get(emp.Employee_ID) || {
        skill_names: [],
        sub_skills: [],
      };
      const pmsInfo = pmsInfoByEmp.get(emp.Employee_ID);
      // Current projects from PMS (any project, imported or not) plus the imported ones we know
      const projects = [
        ...new Set([
          ...(pmsInfo?.projects || []),
          ...(projectsByEmp.get(emp.Employee_ID) || []),
        ]),
      ];

      return {
        emp_id: emp.Employee_ID,
        emp_name: emp.Employee_Name,
        designation: emp.Employee_Designation,
        department: emp.Name_of_Department,
        email: emp.Employee_Official_Email_ID,
        doj: emp.DOJ,
        experience_years: calcExperienceYears(emp.DOJ),
        skills: skills.skill_names,
        sub_skills: skills.sub_skills,
        projects,
        available: pmsInfo?.availability ?? null,
      };
    });

    return res.status(200).json({
      success: true,
      total: merged.length,
      employees: merged,
    });
  } catch (err) {
    console.error("❌ getDeliveryEmployeeDetails error:", err.message);
    return res.status(500).json({
      success: false,
      message: "Failed to load delivery employee details",
      error: err.message,
    });
  }
};

module.exports = { getDeliveryEmployeeDetails };
