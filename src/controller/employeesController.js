const { query } = require('../config/db');
const { fetchAllEmployeesFromHrms } = require('../../services/hrmsService');
const { getSkillsMap } = require('../../services/skillFinderService');
const { getUatToken } = require('../../helpers/pmsTokenStore');
const { calcExperienceYears } = require('../../helpers/experience');
const { pmsGet } = require('../../helpers/pmsHelper');

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

// ─────────────────────────────────────────────────────────────────────────────
// Fetch employee availability from PMS.
//   No_Conflicts           → 'immediate'
//   Already_Project_Exists → latest task planned_end_date (YYYY-MM-DD)
//   otherwise              → null
// ─────────────────────────────────────────────────────────────────────────────
async function fetchEmployeeAvailability(uatToken, empId) {
  try {
    const raw = await pmsGet(
      uatToken,
      `/api/pms/checkEmployeeTaskStatus/${encodeURIComponent(empId)}`
    );

    const info = raw?.info;

    if (info === 'No_Conflicts') {
      return 'immediate';
    }

    if (info === 'Already_Project_Exists') {
      const tasks = Array.isArray(raw?.taskList) ? raw.taskList : [];

      // Latest planned_end_date across all tasks
      const latestEnd = tasks
        .map((t) => t?.planned_end_date)
        .filter(Boolean)
        .sort()
        .slice(-1)[0];

      if (!latestEnd) return null;

      // Format as YYYY-MM-DD (local date, matching the rest of your code)
      const d = new Date(latestEnd);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    }

    return null;
  } catch (err) {
    console.warn(`⚠️ PMS availability check failed for ${empId}: ${err.message}`);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/employees/delivery-details
// ─────────────────────────────────────────────────────────────────────────────
const getDeliveryEmployeeDetails = async (req, res) => {
  try {
    // ─── 1. HRMS employees ────────────────────────────────────────────────
    const allEmployees = await fetchAllEmployeesFromHrms();
    const deliveryEmployees = allEmployees.filter(
      (e) => String(e.Name_of_Department || '').trim() === 'Delivery'
    );

    if (deliveryEmployees.length === 0) {
      return res.status(200).json({ success: true, total: 0, employees: [] });
    }

    // ─── 2. Resolve UAT token ─────────────────────────────────────────────
    const uatToken =
      getUatToken(req.user?.emp_id) || process.env.PMS_SERVICE_TOKEN || null;

    if (!uatToken) {
      return res.status(401).json({
        success: false,
        message: 'No PMS session found. Please log in again.',
      });
    }

    // ─── 3. Quantify DB: which projects each employee is on ──────────────
    const empIds = deliveryEmployees.map((e) => e.Employee_ID).filter(Boolean);
    const placeholders = empIds.map(() => '?').join(',');

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
      empIds
    );

    // ─── 4. Fetch PMS project titles (cached per pms_project_id) ─────────
    const projectTitleCache = new Map();

    async function getProjectTitle(pmsProjectId) {
      if (projectTitleCache.has(pmsProjectId)) {
        return projectTitleCache.get(pmsProjectId);
      }
      try {
        const raw = await pmsGet(uatToken, '/api/pms/getProjectDetails', {
          projectId: pmsProjectId,
        });
        const title = raw?.projectDetails?.project_title || null;
        projectTitleCache.set(pmsProjectId, title);
        return title;
      } catch (err) {
        console.warn(`⚠️ PMS fetch failed for project ${pmsProjectId}: ${err.message}`);
        projectTitleCache.set(pmsProjectId, null);
        return null;
      }
    }

    const uniqueProjectIds = [...new Set(projectRows.map((r) => r.pms_project_id))];
    console.log(`📡 Fetching PMS titles for ${uniqueProjectIds.length} unique project(s)`);

    await runWithConcurrency(uniqueProjectIds, 3, getProjectTitle);

    // ─── 5. Build emp_id → [project_titles] map ──────────────────────────
    const projectsByEmp = new Map();
    for (const r of projectRows) {
      if (!projectsByEmp.has(r.emp_id)) projectsByEmp.set(r.emp_id, []);

      const title =
        projectTitleCache.get(r.pms_project_id) ||   // PMS title (preferred)
        r.project_code ||                            // fallback: project code
        `Project ${r.pms_project_id}`;               // last resort

      const list = projectsByEmp.get(r.emp_id);
      if (!list.includes(title)) list.push(title);
    }

    // ─── 6. Skill Finder: fetch full map once ────────────────────────────
    const skillsMap = await getSkillsMap(uatToken);
    // ─── 6b. Fetch PMS availability per employee (concurrency-limited) ────
    console.log(`📡 Fetching PMS availability for ${deliveryEmployees.length} employee(s)`);

    const availabilityByEmp = new Map();

    await runWithConcurrency(deliveryEmployees, 3, async (emp) => {
      const avail = await fetchEmployeeAvailability(uatToken, emp.Employee_ID);
      availabilityByEmp.set(emp.Employee_ID, avail);
    });

    // ─── 7. Merge everything ─────────────────────────────────────────────
    const merged = deliveryEmployees.map((emp) => {
      const skills = skillsMap.get(emp.Employee_ID) || { skill_names: [], sub_skills: [] };
      const projects = projectsByEmp.get(emp.Employee_ID) || [];

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
        available: availabilityByEmp.get(emp.Employee_ID) ?? null, 
      };
    });

    return res.status(200).json({
      success: true,
      total: merged.length,
      employees: merged,
    });
  } catch (err) {
    console.error('❌ getDeliveryEmployeeDetails error:', err.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to load delivery employee details',
      error: err.message,
    });
  }
};

module.exports = { getDeliveryEmployeeDetails };