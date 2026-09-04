// Backend/src/controller/sdlc.controller.js
// ─────────────────────────────────────────────────────────────────────────────
// SDLC Governance Controller
// All routes are admin-only except getProjectGovernance (any auth)
// ─────────────────────────────────────────────────────────────────────────────
const { query } = require('../config/db');

// ── Master checklist definition (single source of truth) ─────────────────────
const CHECKLIST_MASTER = {
  req: [
    { id: 'r1',  text: 'Requirement document received',    mandatory: true,  category: 'Business' },
    { id: 'r2',  text: 'BRD created',                     mandatory: true,  category: 'Business' },
    { id: 'r3',  text: 'BRD reviewed',                    mandatory: true,  category: 'Business' },
    { id: 'r4',  text: 'BRD signed off',                  mandatory: true,  category: 'Business' },
    { id: 'r5',  text: 'Scope finalized',                 mandatory: true,  category: 'Business' },
    { id: 'r6',  text: 'Client expectations documented',  mandatory: false, category: 'Business' },
    { id: 'r7',  text: 'Dependencies identified',         mandatory: false, category: 'Business' },
    { id: 'r8',  text: 'Stakeholders identified',         mandatory: true,  category: 'Business' },
    { id: 'r9',  text: 'Risk identified',                 mandatory: false, category: 'Business' },
    { id: 'r10', text: 'Requirement freeze done',         mandatory: true,  category: 'Business' },
    { id: 'r11', text: 'Tech stack finalized',            mandatory: true,  category: 'Technical' },
    { id: 'r12', text: 'Feasibility checked',             mandatory: true,  category: 'Technical' },
    { id: 'r13', text: 'API dependencies identified',     mandatory: false, category: 'Technical' },
    { id: 'r14', text: 'Security requirements gathered',  mandatory: false, category: 'Technical' },
  ],
  plan: [
    { id: 'p1',  text: 'Project manager assigned',        mandatory: true,  category: 'Planning' },
    { id: 'p2',  text: 'Team assigned',                   mandatory: true,  category: 'Planning' },
    { id: 'p3',  text: 'Sprint planning done',            mandatory: true,  category: 'Planning' },
    { id: 'p4',  text: 'Milestones defined',              mandatory: true,  category: 'Planning' },
    { id: 'p5',  text: 'Delivery dates finalized',        mandatory: true,  category: 'Planning' },
    { id: 'p6',  text: 'Git repository created',          mandatory: true,  category: 'Dev Readiness' },
    { id: 'p7',  text: 'Database schema finalized',       mandatory: true,  category: 'Dev Readiness' },
    { id: 'p8',  text: 'API contract finalized',          mandatory: true,  category: 'Dev Readiness' },
    { id: 'p9',  text: 'Dev server ready',                mandatory: true,  category: 'Dev Readiness' },
    { id: 'p10', text: 'Test server ready',               mandatory: false, category: 'Dev Readiness' },
    { id: 'p11', text: 'Wireframes ready',                mandatory: true,  category: 'UI/UX' },
    { id: 'p12', text: 'UI approval received',            mandatory: true,  category: 'UI/UX' },
    { id: 'p13', text: 'Tables finalized',                mandatory: true,  category: 'Database' },
    { id: 'p14', text: 'Backup strategy ready',           mandatory: false, category: 'Database' },
    { id: 'p15', text: 'Rollback plan ready',             mandatory: true,  category: 'Database' },
  ],
  dev: [
    { id: 'd1',  text: 'Daily updates submitted',         mandatory: true,  category: 'Tracking' },
    { id: 'd2',  text: 'Sprint progress updated',         mandatory: true,  category: 'Tracking' },
    { id: 'd3',  text: 'Blockers updated',                mandatory: false, category: 'Tracking' },
    { id: 'd4',  text: 'All modules started',             mandatory: true,  category: 'Development' },
    { id: 'd5',  text: 'APIs completed',                  mandatory: true,  category: 'Development' },
    { id: 'd6',  text: 'Frontend completed',              mandatory: true,  category: 'Development' },
    { id: 'd7',  text: 'Backend completed',               mandatory: true,  category: 'Development' },
    { id: 'd8',  text: 'Error handling added',            mandatory: true,  category: 'Development' },
    { id: 'd9',  text: 'Security checks implemented',     mandatory: true,  category: 'Development' },
    { id: 'd10', text: 'Code review approved',            mandatory: true,  category: 'Development' },
    { id: 'd11', text: 'Documentation updated',           mandatory: false, category: 'Development' },
  ],
  test: [
    { id: 't1',  text: 'Test cases prepared',             mandatory: true,  category: 'QA' },
    { id: 't2',  text: 'Unit testing completed',          mandatory: true,  category: 'QA' },
    { id: 't3',  text: 'Integration testing completed',   mandatory: true,  category: 'QA' },
    { id: 't4',  text: 'Functional testing completed',    mandatory: true,  category: 'QA' },
    { id: 't5',  text: 'Regression testing completed',    mandatory: false, category: 'QA' },
    { id: 't6',  text: 'Security testing completed',      mandatory: true,  category: 'QA' },
    { id: 't7',  text: 'UAT completed',                   mandatory: true,  category: 'QA' },
    { id: 't8',  text: 'Client feedback received',        mandatory: true,  category: 'QA' },
    { id: 't9',  text: 'Bugs logged',                     mandatory: false, category: 'Bug Tracking' },
    { id: 't10', text: 'Critical bugs closed',            mandatory: true,  category: 'Bug Tracking' },
  ],
  deploy_plan: [
    { id: 'dp1',  text: 'Deployment plan prepared',              mandatory: true,  category: 'Readiness' },
    { id: 'dp2',  text: 'Rollback plan prepared',                mandatory: true,  category: 'Readiness' },
    { id: 'dp3',  text: 'Downtime informed',                     mandatory: false, category: 'Readiness' },
    { id: 'dp4',  text: 'Deployment approvals received',         mandatory: true,  category: 'Readiness' },
    { id: 'dp5',  text: 'Database migration scripts ready',      mandatory: true,  category: 'Readiness' },
    { id: 'dp6',  text: 'Backup completed',                      mandatory: true,  category: 'Readiness' },
    { id: 'dp7',  text: 'Production environment verified',       mandatory: true,  category: 'Readiness' },
    { id: 'dp8',  text: 'SSL/domain verified',                   mandatory: true,  category: 'Risks' },
    { id: 'dp9',  text: 'No server issues pending',              mandatory: true,  category: 'Risks' },
    { id: 'dp10', text: 'No DNS issues pending',                 mandatory: false, category: 'Risks' },
  ],
  deploy: [
    { id: 'de1', text: 'Build deployed',                 mandatory: true,  category: 'Production' },
    { id: 'de2', text: 'Database migration executed',    mandatory: true,  category: 'Production' },
    { id: 'de3', text: 'APIs verified',                  mandatory: true,  category: 'Production' },
    { id: 'de4', text: 'Frontend verified',              mandatory: true,  category: 'Production' },
    { id: 'de5', text: 'Smoke testing completed',        mandatory: true,  category: 'Production' },
    { id: 'de6', text: 'Logs monitored',                 mandatory: false, category: 'Production' },
    { id: 'de7', text: 'Production signoff received',    mandatory: true,  category: 'Production' },
  ],
  demo: [
    { id: 'dm1', text: 'Demo scheduled',                 mandatory: true,  category: 'Demo' },
    { id: 'dm2', text: 'Demo environment ready',         mandatory: true,  category: 'Demo' },
    { id: 'dm3', text: 'Client walkthrough completed',   mandatory: true,  category: 'Demo' },
    { id: 'dm4', text: 'Feedback documented',            mandatory: true,  category: 'Demo' },
    { id: 'dm5', text: 'Change requests logged',         mandatory: false, category: 'Demo' },
    { id: 'dm6', text: 'Final approval received',        mandatory: true,  category: 'Demo' },
  ],
  support: [
    { id: 's1', text: 'Monitoring enabled',              mandatory: true,  category: 'Support' },
    { id: 's2', text: 'Logs monitored',                  mandatory: false, category: 'Support' },
    { id: 's3', text: 'User issues tracked',             mandatory: true,  category: 'Support' },
    { id: 's4', text: 'SLA defined',                     mandatory: true,  category: 'Support' },
    { id: 's5', text: 'Support owner assigned',          mandatory: true,  category: 'Support' },
    { id: 's6', text: 'Knowledge transfer completed',    mandatory: false, category: 'Support' },
  ],
  closure: [
    { id: 'cl1', text: 'Final signoff received',         mandatory: true,  category: 'Closure' },
    { id: 'cl2', text: 'Source code archived',           mandatory: true,  category: 'Closure' },
    { id: 'cl3', text: 'Documents archived',             mandatory: false, category: 'Closure' },
    { id: 'cl4', text: 'Lessons learned documented',     mandatory: false, category: 'Closure' },
    { id: 'cl5', text: 'Team retrospective completed',   mandatory: false, category: 'Closure' },
    { id: 'cl6', text: 'Support handover completed',     mandatory: true,  category: 'Closure' },
  ],
};

// Gate rules — which checklist items must be done before a stage can start
const GATE_RULES = {
  dev: {
    label: 'Development cannot start until:',
    checks: ['r4', 'r10', 'p7', 'p8', 'p11', 'p12'],
  },
  deploy: {
    label: 'Deployment cannot start until:',
    checks: ['d5', 'd6', 'd7', 'd10', 't4', 't7', 't8', 't10', 'dp1', 'dp2', 'dp4', 'dp5', 'dp6', 'dp7'],
  },
  closure: {
    label: 'Project cannot close until:',
    checks: ['de7', 'dm6', 's5'],
  },
};

// ── Helper: build a flat lookup of item_id → stage_id ────────────────────────
function buildItemStageMap() {
  const map = {};
  for (const [stageId, items] of Object.entries(CHECKLIST_MASTER)) {
    for (const item of items) {
      map[item.id] = stageId;
    }
  }
  return map;
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/sdlc/projects
// Returns all projects with their current_stage, risk_level, health score
// ─────────────────────────────────────────────────────────────────────────────
const getAllProjectsGovernance = async (req, res, next) => {
  try {
    const projects = await query(`
      SELECT p.id, p.project_name, p.client_name, p.start_date, p.end_date,
             p.status, p.current_stage, p.risk_level, p.project_manager
      FROM projects p ORDER BY p.id ASC
    `);

    // Attach health score for each project
    const result = await Promise.all(projects.map(async (proj) => {
      const checkedRows = await query(
        `SELECT COUNT(*) AS done FROM project_checklists WHERE project_id = ? AND is_checked = 1`,
        [proj.id]
      );
      const totalRows = await query(
        `SELECT COUNT(*) AS total FROM project_checklists WHERE project_id = ?`,
        [proj.id]
      );
      const openBlockers = await query(
        `SELECT COUNT(*) AS cnt FROM project_blockers WHERE project_id = ? AND status = 'open' AND priority = 'high'`,
        [proj.id]
      );
      const done  = Number(checkedRows[0]?.done  || 0);
      const total = Number(totalRows[0]?.total || 0);
      const penalty = Number(openBlockers[0]?.cnt || 0) * 3;
      const health = total > 0 ? Math.max(0, Math.round((done / total) * 100) - penalty) : 0;
      return { ...proj, health_score: health, checked_count: done, total_count: total };
    }));

    return res.status(200).json(result);
  } catch (err) {
    return next(err);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/sdlc/:projectId
// Returns full governance data for one project
// ─────────────────────────────────────────────────────────────────────────────
const getProjectGovernance = async (req, res, next) => {
  try {
    const { projectId } = req.params;

    const projects = await query(
      `SELECT id, project_name, client_name, start_date, end_date, status,
              current_stage, risk_level, project_manager
       FROM projects WHERE id = ? LIMIT 1`,
      [projectId]
    );
    if (!projects.length) return res.status(404).json({ message: 'Project not found' });

    const project = projects[0];

    // Fetch saved checklist rows
    const savedChecks = await query(
      `SELECT stage_id, item_id, is_checked, completed_by, completed_at, verified_by, comments
       FROM project_checklists WHERE project_id = ?`,
      [projectId]
    );

    // Map saved checks by stage_item key
    const checkMap = {};
    for (const row of savedChecks) {
      checkMap[`${row.stage_id}_${row.item_id}`] = row;
    }

    // Merge master with saved state
    const checklists = {};
    for (const [stageId, items] of Object.entries(CHECKLIST_MASTER)) {
      checklists[stageId] = items.map(item => {
        const saved = checkMap[`${stageId}_${item.id}`];
        return {
          ...item,
          is_checked:    saved ? !!saved.is_checked   : false,
          completed_by:  saved?.completed_by  || null,
          completed_at:  saved?.completed_at  || null,
          verified_by:   saved?.verified_by   || null,
          comments:      saved?.comments      || null,
        };
      });
    }

    // Fetch stages
    const stages = await query(
      `SELECT stage_id, status, started_at, completed_at FROM project_stages WHERE project_id = ?`,
      [projectId]
    );

    // Fetch blockers
    const blockers = await query(
      `SELECT id, title, description, priority, owner, status, created_at, resolved_at
       FROM project_blockers WHERE project_id = ? ORDER BY created_at DESC`,
      [projectId]
    );

    // Compute gate statuses
    const itemStageMap = buildItemStageMap();
    const gates = {};
    for (const [gateId, rule] of Object.entries(GATE_RULES)) {
      const pending = rule.checks.filter(itemId => {
        const stageId = itemStageMap[itemId];
        const saved = checkMap[`${stageId}_${itemId}`];
        return !saved || !saved.is_checked;
      });
      gates[gateId] = {
        label:   rule.label,
        passed:  pending.length === 0,
        pending: pending.map(itemId => {
          const stageId = itemStageMap[itemId];
          const item = (CHECKLIST_MASTER[stageId] || []).find(i => i.id === itemId);
          return { id: itemId, text: item?.text || itemId, stage: stageId };
        }),
      };
    }

    // Health score
    const allItems = Object.values(checklists).flat();
    const doneItems = allItems.filter(i => i.is_checked);
    const openHighBlockers = blockers.filter(b => b.status === 'open' && b.priority === 'high').length;
    const health = allItems.length > 0
      ? Math.max(0, Math.round((doneItems.length / allItems.length) * 100) - openHighBlockers * 3)
      : 0;

    return res.status(200).json({
      project,
      checklists,
      stages,
      blockers,
      gates,
      health_score:   health,
      checked_count:  doneItems.length,
      total_count:    allItems.length,
    });
  } catch (err) {
    return next(err);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/sdlc/:projectId/checklist
// Toggle a checklist item (upsert)
// Body: { stage_id, item_id, is_checked, completed_by, comments }
// ─────────────────────────────────────────────────────────────────────────────
const updateChecklistItem = async (req, res, next) => {
  try {
    const { projectId } = req.params;
    const { stage_id, item_id, is_checked, completed_by, verified_by, comments } = req.body;

    if (!stage_id || !item_id) {
      return res.status(400).json({ message: 'stage_id and item_id are required' });
    }

    // Find item in master
    const stageItems = CHECKLIST_MASTER[stage_id];
    if (!stageItems) return res.status(400).json({ message: 'Invalid stage_id' });
    const masterItem = stageItems.find(i => i.id === item_id);
    if (!masterItem) return res.status(400).json({ message: 'Invalid item_id' });

    const completedAt = is_checked ? new Date() : null;

    await query(
      `INSERT INTO project_checklists
         (project_id, stage_id, item_id, item_text, category, is_mandatory, is_checked,
          completed_by, completed_at, verified_by, comments)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         is_checked   = VALUES(is_checked),
         completed_by = VALUES(completed_by),
         completed_at = VALUES(completed_at),
         verified_by  = VALUES(verified_by),
         comments     = VALUES(comments)`,
      [
        projectId, stage_id, item_id, masterItem.text, masterItem.category,
        masterItem.mandatory ? 1 : 0,
        is_checked ? 1 : 0,
        completed_by || req.user?.name || 'Admin',
        completedAt,
        verified_by || null,
        comments || null,
      ]
    );

    return res.status(200).json({ message: 'Checklist item updated' });
  } catch (err) {
    return next(err);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/sdlc/:projectId/stage
// Update the current stage of a project + stage status
// Body: { current_stage }
// ─────────────────────────────────────────────────────────────────────────────
const updateProjectStage = async (req, res, next) => {
  try {
    const { projectId } = req.params;
    const { current_stage } = req.body;

    if (!current_stage) return res.status(400).json({ message: 'current_stage required' });

    await query(
      `UPDATE projects SET current_stage = ? WHERE id = ?`,
      [current_stage, projectId]
    );

    // Mark stage as inprogress
    await query(
      `UPDATE project_stages SET status = 'inprogress', started_at = NOW()
       WHERE project_id = ? AND stage_id = ? AND status = 'pending'`,
      [projectId, current_stage]
    );

    return res.status(200).json({ message: 'Stage updated' });
  } catch (err) {
    return next(err);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/sdlc/:projectId/risk
// Body: { risk_level }
// ─────────────────────────────────────────────────────────────────────────────
const updateProjectRisk = async (req, res, next) => {
  try {
    const { projectId } = req.params;
    const { risk_level } = req.body;
    if (!['low', 'medium', 'high'].includes(risk_level)) {
      return res.status(400).json({ message: 'risk_level must be low, medium or high' });
    }
    await query(`UPDATE projects SET risk_level = ? WHERE id = ?`, [risk_level, projectId]);
    return res.status(200).json({ message: 'Risk updated' });
  } catch (err) {
    return next(err);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/sdlc/:projectId/blockers
// Body: { title, description, priority, owner }
// ─────────────────────────────────────────────────────────────────────────────
const addBlocker = async (req, res, next) => {
  try {
    const { projectId } = req.params;
    const { title, description, priority, owner } = req.body;
    if (!title) return res.status(400).json({ message: 'title is required' });

    const result = await query(
      `INSERT INTO project_blockers (project_id, title, description, priority, owner, raised_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [projectId, title, description || null, priority || 'medium', owner || null, req.user?.id || null]
    );
    return res.status(201).json({ id: result.insertId, message: 'Blocker added' });
  } catch (err) {
    return next(err);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/sdlc/:projectId/blockers/:blockerId/resolve
// ─────────────────────────────────────────────────────────────────────────────
const resolveBlocker = async (req, res, next) => {
  try {
    const { projectId, blockerId } = req.params;
    await query(
      `UPDATE project_blockers SET status = 'resolved', resolved_at = NOW()
       WHERE id = ? AND project_id = ?`,
      [blockerId, projectId]
    );
    return res.status(200).json({ message: 'Blocker resolved' });
  } catch (err) {
    return next(err);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/sdlc/:projectId/weekly-report
// Returns a structured weekly status summary
// ─────────────────────────────────────────────────────────────────────────────
const getWeeklyReport = async (req, res, next) => {
  try {
    const { projectId } = req.params;

    const savedChecks = await query(
      `SELECT stage_id, item_id, is_checked, completed_by, completed_at
       FROM project_checklists WHERE project_id = ?`,
      [projectId]
    );

    const checkMap = {};
    for (const row of savedChecks) {
      checkMap[`${row.stage_id}_${row.item_id}`] = row;
    }

    const completed = [];
    const pending   = [];
    const risks     = [];

    for (const [stageId, items] of Object.entries(CHECKLIST_MASTER)) {
      for (const item of items) {
        const saved = checkMap[`${stageId}_${item.id}`];
        if (saved?.is_checked) {
          completed.push({ text: item.text, stage: stageId, completed_by: saved.completed_by });
        } else if (item.mandatory) {
          pending.push({ text: item.text, stage: stageId });
        }
      }
    }

    const blockers = await query(
      `SELECT title, priority FROM project_blockers WHERE project_id = ? AND status = 'open'`,
      [projectId]
    );
    for (const b of blockers) {
      risks.push({ text: `Blocker (${b.priority}): ${b.title}` });
    }

    return res.status(200).json({ completed, pending, risks });
  } catch (err) {
    return next(err);
  }
};

module.exports = {
  getAllProjectsGovernance,
  getProjectGovernance,
  updateChecklistItem,
  updateProjectStage,
  updateProjectRisk,
  addBlocker,
  resolveBlocker,
  getWeeklyReport,
};
