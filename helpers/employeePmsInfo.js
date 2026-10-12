const {
  pmsGet,
  extractProjects,
  extractProjectDetails,
} = require("./pmsHelper");

// ─────────────────────────────────────────────────────────────────────────────
// Per-employee PMS info (availability + current projects), shared by Member Details and
// Skill Analytics. Both need one PMS call per employee (700+), which is far too slow to repeat
// on every visit, so successful lookups are cached and a lookup already running is shared.
// A request the browser gave up on still fills the cache, so the next attempt is much faster.
// ─────────────────────────────────────────────────────────────────────────────
const TTL_MS = 15 * 60 * 1000;
const infoCache = new Map(); // empId -> { availability, at }
const infoInFlight = new Map(); // empId -> Promise<availability>

// ─────────────────────────────────────────────────────────────────────────────
// Current projects per employee, built from PMS's own project data: every project's tasks
// (getProjectDetails → tasksDetails) carry the assignee's emp_id, so an employee's current
// projects are the projects where they still have an unfinished task. This covers every PMS
// project, imported into Quantify or not. Built once for everyone, cached, shared by requests.
// ─────────────────────────────────────────────────────────────────────────────
const PROJECT_FETCH_CONCURRENCY = 8;

// Only projects in these PMS statuses count as "current". Override in .env, comma separated:
//   PMS_CURRENT_PROJECT_STATUSES=APPROVED,ON_HOLD
// The startup log of the map build lists the statuses PMS actually uses and how many projects
// have each, so the list can be adjusted to match.
const currentStatuses = () =>
  new Set(
    String(process.env.PMS_CURRENT_PROJECT_STATUSES || "APPROVED")
      .split(",")
      .map((v) => v.trim().toLowerCase())
      .filter(Boolean),
  );
let projectMapCache = { map: null, at: 0 };
let projectMapInFlight = null;

const isFinishedTask = (task) =>
  Boolean(task?.actual_end_date) ||
  /complete|closed|done|cancel/i.test(String(task?.status || ""));

async function buildProjectsByEmployee(uatToken) {
  const projectsByEmp = new Map();
  const wanted = currentStatuses();
  const list = extractProjects(
    await pmsGet(uatToken, "/api/pms/getAllProjects"),
  );

  const statusCounts = {};
  for (const project of list) {
    const key = String(project.status ?? "UNKNOWN").trim() || "UNKNOWN";
    statusCounts[key] = (statusCounts[key] || 0) + 1;
  }
  const isWanted = (status) =>
    wanted.has(
      String(status ?? "")
        .trim()
        .toLowerCase(),
    );
  // Projects whose status is listed are filtered before any details call; if the list carries
  // no status at all, the status from the details response is used instead.
  const listHasStatus = list.some((p) => p.status != null);
  const candidates = listHasStatus
    ? list.filter((p) => isWanted(p.status))
    : list;
  console.log(
    `📡 PMS projects by status: ${JSON.stringify(statusCounts)} → reading ${candidates.length} project(s) with status in [${[...wanted].join(", ")}]`,
  );

  let index = 0;
  let failed = 0;
  async function next() {
    const i = index++;
    if (i >= candidates.length) return;
    const project = candidates[i];
    const projectId = project.project_id ?? project.id;
    try {
      const raw = await pmsGet(uatToken, "/api/pms/getProjectDetails", {
        projectId,
      });
      const status =
        project.status ?? raw?.projectDetails?.status ?? raw?.status;
      const title =
        raw?.projectDetails?.project_title ||
        project.project_title ||
        project.title;
      if (title && isWanted(status)) {
        for (const task of extractProjectDetails(raw).tasks) {
          const empId = String(task?.emp_id ?? "").trim();
          if (!empId || isFinishedTask(task)) continue;
          if (!projectsByEmp.has(empId)) projectsByEmp.set(empId, new Set());
          projectsByEmp.get(empId).add(String(title).trim());
        }
      }
    } catch (err) {
      failed++;
      console.warn(`⚠️ PMS project ${projectId} skipped: ${err.message}`);
    }
    return next();
  }
  await Promise.all(
    Array.from(
      { length: Math.min(PROJECT_FETCH_CONCURRENCY, candidates.length) },
      next,
    ),
  );

  // Don't keep a map built while PMS was mostly failing — the next request rebuilds it
  const complete = failed <= candidates.length * 0.1;
  return {
    map: new Map([...projectsByEmp].map(([k, v]) => [k, [...v]])),
    complete,
  };
}

async function getProjectsByEmployee(uatToken) {
  if (projectMapCache.map && Date.now() - projectMapCache.at < TTL_MS)
    return projectMapCache.map;
  if (!projectMapInFlight) {
    projectMapInFlight = buildProjectsByEmployee(uatToken)
      .then(({ map, complete }) => {
        if (complete) projectMapCache = { map, at: Date.now() };
        return map;
      })
      .catch((err) => {
        console.warn(`⚠️ PMS current-projects map failed: ${err.message}`);
        return new Map();
      })
      .finally(() => {
        projectMapInFlight = null;
      });
  }
  return projectMapInFlight;
}

async function lookup(uatToken, empId) {
  const path = `/api/pms/checkEmployeeTaskStatus/${encodeURIComponent(empId)}`;
  try {
    let raw;
    try {
      raw = await pmsGet(uatToken, path);
    } catch (err) {
      // PMS answers 503 when it is busy; one short retry clears most of them
      if (err.response?.status !== 503) throw err;
      await new Promise((resolve) => setTimeout(resolve, 500));
      raw = await pmsGet(uatToken, path);
    }

    const info = raw?.info;
    const tasks = Array.isArray(raw?.taskList) ? raw.taskList : [];

    if (info === "No_Conflicts") {
      return { ok: true, availability: "immediate" };
    }

    if (info === "Already_Project_Exists") {
      // Latest planned_end_date across all tasks
      const latestEnd = tasks
        .map((t) => t?.planned_end_date)
        .filter(Boolean)
        .sort()
        .slice(-1)[0];

      let availability = null;
      if (latestEnd) {
        // YYYY-MM-DD (local date, matching the rest of the code)
        const d = new Date(latestEnd);
        availability = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      }

      return { ok: true, availability };
    }

    return { ok: true, availability: null };
  } catch (err) {
    console.warn(
      `⚠️ PMS availability check failed for ${empId}: ${err.message}`,
    );
    // ok:false → not cached, so the next request tries this employee again
    return { ok: false, availability: null };
  }
}

// Availability is looked up per employee (cached); current projects come from the shared map.
async function getAvailability(uatToken, empId) {
  const hit = infoCache.get(empId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.availability;
  if (infoInFlight.has(empId)) return infoInFlight.get(empId);

  const promise = lookup(uatToken, empId)
    .then((result) => {
      if (result.ok)
        infoCache.set(empId, {
          availability: result.availability,
          at: Date.now(),
        });
      return result.availability;
    })
    .finally(() => infoInFlight.delete(empId));

  infoInFlight.set(empId, promise);
  return promise;
}

/** @returns {Promise<{availability: string|null, projects: string[]}>} */
async function getEmployeePmsInfo(uatToken, empId) {
  const [availability, projectsByEmp] = await Promise.all([
    getAvailability(uatToken, empId),
    getProjectsByEmployee(uatToken),
  ]);
  return {
    availability,
    projects: projectsByEmp.get(String(empId).trim()) || [],
  };
}

function isEmployeeInfoCached(empId) {
  const hit = infoCache.get(empId);
  return Boolean(hit && Date.now() - hit.at < TTL_MS);
}

module.exports = { getEmployeePmsInfo, isEmployeeInfoCached };
