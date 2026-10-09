const axios = require('axios');

const BASE = process.env.SKILL_FINDER_BASE_URL;
const TIMEOUT = Number(process.env.SKILL_FINDER_TIMEOUT_MS) || 20000;

let skillsCache = null;
let skillsCacheAt = 0;
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Fetch the entire Skill Finder response and build a Map keyed by emp_id.
 * Cached for 30 minutes.
 */
async function getSkillsMap(uatToken) {
  const now = Date.now();
  if (skillsCache && now - skillsCacheAt < CACHE_TTL_MS) {
    return skillsCache;
  }

  if (!BASE) throw new Error('SKILL_FINDER_BASE_URL is not configured');

  const url = `${BASE}/api/skill-finder/fetch-skills-by-empid-or-by-skillname`;

  const res = await axios.get(url, {
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${uatToken}`,
    },
    timeout: TIMEOUT,
  });

  const raw = res.data?.data || res.data || [];
  const flat = Array.isArray(raw?.[0]) ? raw[0] : Array.isArray(raw) ? raw : [raw];

  const map = new Map();

  for (const entry of flat) {
    const id = entry?.EmployeeInformation?.employee_id;
    if (!id) continue;

    const skillNames = new Set();
    const subSkills = new Set();

    for (const s of entry.SkillInformation || []) {
      if (s?.skill_name) skillNames.add(s.skill_name.trim());
      if (s?.sub_skills) {
        String(s.sub_skills)
          .split(',')
          .map((x) => x.trim())
          .filter(Boolean)
          .forEach((x) => subSkills.add(x));
      }
    }

    map.set(String(id).trim(), {
      skill_names: [...skillNames],
      sub_skills: [...subSkills],
    });
  }

  console.log(`📥 Skill Finder cache built: ${map.size} employees`);

  skillsCache = map;
  skillsCacheAt = now;
  return map;
}

/**
 * Return skills for a single employee (looked up from the cache).
 */
async function fetchSkillsByEmpId(uatToken, empId) {
  const map = await getSkillsMap(uatToken);
  return map.get(String(empId).trim()) || { skill_names: [], sub_skills: [] };
}

module.exports = { getSkillsMap, fetchSkillsByEmpId };