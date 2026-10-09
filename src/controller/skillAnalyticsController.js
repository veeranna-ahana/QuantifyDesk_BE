const { query } = require('../config/db');
const { fetchAllEmployeesFromHrms } = require('../../services/hrmsService');
const { getSkillsMap } = require('../../services/skillFinderService');
const { getUatToken } = require('../../helpers/pmsTokenStore');
const { calcExperienceYears } = require('../../helpers/experience');
const { pmsGet } = require('../../helpers/pmsHelper');

// ─────────────────────────────────────────────────────────────────────────────
// Concurrency helper (inline — no external dependency)
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
// GET /api/skills/analytics
//
// Per skill: list of employees who have that skill (with projects).
//
// Query params (all optional):
//   ?department=Delivery        default = 'Delivery'; pass 'all' to disable
//   ?skill=Java                 filter to a single skill/sub-skill
//   ?include_sub_skills=true    also group by sub-skill
// ─────────────────────────────────────────────────────────────────────────────
const getSkillAnalytics = async (req, res) => {
  try {
    // ─── 1. Resolve token ─────────────────────────────────────────────
    const uatToken =
      getUatToken(req.user?.emp_id) || process.env.PMS_SERVICE_TOKEN || null;

    if (!uatToken) {
      return res.status(401).json({
        success: false,
        message: 'No PMS session found. Please log in again.',
      });
    }

    // ─── 2. Parse filters ─────────────────────────────────────────────
    const rawDept = req.query.department;
    const filterDept =
      rawDept === undefined
        ? 'Delivery'                                       // default
        : rawDept === 'all' || rawDept === ''
          ? ''                                             // disable filter
          : String(rawDept).trim();

    const filterSkill = (req.query.skill || '').trim();
    const includeSubSkills =
      String(req.query.include_sub_skills || '').toLowerCase() === 'true';

    // ─── 3. Fetch HRMS + Skill Finder ─────────────────────────────────
    const allEmployees = await fetchAllEmployeesFromHrms();

    const hrmsById = new Map();
    for (const e of allEmployees) {
      if (!e.Employee_ID) continue;
      hrmsById.set(String(e.Employee_ID).trim(), e);
    }

    const skillsMap = await getSkillsMap(uatToken);

    // ─── 4. Invert to skill_name → [employees] ────────────────────────
    const bySkill = new Map();
    const bySubSkill = new Map();

    for (const [empId, skillData] of skillsMap.entries()) {
      const hrms = hrmsById.get(String(empId).trim());
      if (!hrms) continue;

      // Department filter
      if (
        filterDept &&
        String(hrms.Name_of_Department || '').trim() !== filterDept
      ) {
        continue;
      }

      const empObj = {
        emp_id: empId,
        emp_name: hrms.Employee_Name,
        designation: hrms.Employee_Designation,
        department: hrms.Name_of_Department,
        email: hrms.Employee_Official_Email_ID,
        doj: hrms.DOJ,
        experience_years: calcExperienceYears(hrms.DOJ),
      };

      for (const skill of skillData.skill_names || []) {
        if (filterSkill && skill.toLowerCase() !== filterSkill.toLowerCase()) continue;
        if (!bySkill.has(skill)) bySkill.set(skill, []);
        bySkill.get(skill).push(empObj);
      }

      if (includeSubSkills) {
        for (const sub of skillData.sub_skills || []) {
          if (filterSkill && sub.toLowerCase() !== filterSkill.toLowerCase()) continue;
          if (!bySubSkill.has(sub)) bySubSkill.set(sub, []);
          bySubSkill.get(sub).push(empObj);
        }
      }
    }

    // ─── 5. Fetch projects for every employee in the result ───────────
    //      (AFTER bySkill is populated — this is what the previous
    //       version had wrong.)
    const allEmpIds = new Set();
    for (const emps of bySkill.values()) {
      for (const e of emps) allEmpIds.add(e.emp_id);
    }
    if (includeSubSkills) {
      for (const emps of bySubSkill.values()) {
        for (const e of emps) allEmpIds.add(e.emp_id);
      }
    }
    const empIdList = [...allEmpIds];

    const projectsByEmp = new Map();

    if (empIdList.length > 0) {
      const placeholders = empIdList.map(() => '?').join(',');

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
        empIdList
      );

      // Fetch PMS titles once per unique project
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

      const uniqueProjectIds = [
        ...new Set(projectRows.map((r) => r.pms_project_id)),
      ];

      console.log(
        `📡 Skill analytics: fetching PMS titles for ${uniqueProjectIds.length} project(s)`
      );

      await runWithConcurrency(uniqueProjectIds, 3, getProjectTitle);

      for (const r of projectRows) {
        if (!projectsByEmp.has(r.emp_id)) projectsByEmp.set(r.emp_id, []);
        const title =
          projectTitleCache.get(r.pms_project_id) ||
          r.project_code ||
          `Project ${r.pms_project_id}`;
        const list = projectsByEmp.get(r.emp_id);
        if (!list.includes(title)) list.push(title);
      }
    }

    // ─── 6. Format response ───────────────────────────────────────────
    const formatGroup = (map) =>
      [...map.entries()]
        .map(([name, emps]) => ({
          skill_name: name,
          employee_count: emps.length,
          employees: emps
            .sort((a, b) =>
              String(a.emp_name).localeCompare(String(b.emp_name))
            )
            .map((e) => {
              const projects = projectsByEmp.get(e.emp_id) || [];
              return {
                emp_id: e.emp_id,
                emp_name: e.emp_name,
                designation: e.designation,
                department: e.department,
                experience_years: e.experience_years,
                projects:
                  projects.length > 0 ? projects : ['No Projects'],
              };
            }),
        }))
        .sort((a, b) => b.employee_count - a.employee_count);

    const skills = formatGroup(bySkill);
    const subSkills = includeSubSkills ? formatGroup(bySubSkill) : undefined;

    return res.status(200).json({
      success: true,
      total_skills: skills.length,
      filters: {
        department: filterDept || 'ALL',
        skill: filterSkill || null,
        include_sub_skills: includeSubSkills,
      },
      skills,
      ...(includeSubSkills ? { sub_skills: subSkills } : {}),
    });
  } catch (err) {
    console.error('❌ getSkillAnalytics error:', err.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to load skill analytics',
      error: err.message,
    });
  }
};

module.exports = { getSkillAnalytics };