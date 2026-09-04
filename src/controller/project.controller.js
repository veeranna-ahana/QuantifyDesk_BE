const { query, projectCodeQuery } = require('../config/db');
const axios = require('axios');

// ============================================
// CONFIGURATION
// ============================================
const PMS_CONFIG = {
  baseUrl: 'http://172.16.20.61:5001',
  timeout: 10000,
};

// ============================================
// HELPER: Get headers with token from request
// ============================================
function getPMSHeaders(req) {
  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };
  
  // Forward the authorization token from the incoming request
  const authHeader = req.headers.authorization;
  if (authHeader) {
    headers['Authorization'] = authHeader;
  } else {
    console.warn('⚠️ No authorization header found in request');
  }
  
  return headers;
}


// ─────────────────────────────────────────────────────────────────────────────
// POST /api/projects
// Body: { name, clientName, description, nbdId, o2dId, projectCode,
//         subCategory, startDate, endDate, status }
// ─────────────────────────────────────────────────────────────────────────────
const createProject = async (req, res, next) => {
  try {
    console.log('📥 Creating new project...');
    console.log('📋 Request Body:', req.body);
    
    const {
      name,
      clientName,
      description,
      nbdId,
      o2dId,
      projectCode,
      subCategory,
      startDate,
      endDate,
      status,
      projectType,
      teamLead,
      pmsProjectId,
    } = req.body;

    if (!name || !clientName) {
      return res.status(400).json({
        message: 'Project name and client name are required',
      });
    }

    if (startDate && endDate && new Date(endDate) < new Date(startDate)) {
      return res.status(400).json({
        message: 'End date cannot be earlier than start date',
      });
    }

    // Check for duplicates
    const duplicateErrors = [];
    const duplicateDetails = [];

    // Check project_name
    const nameCheck = await query(
      'SELECT id, project_name FROM projects WHERE project_name = ?',
      [name]
    );
    if (nameCheck.length > 0) {
      duplicateErrors.push(`Project name "${name}" is already in use`);
      duplicateDetails.push({
        id: nameCheck[0].id,
        project_name: nameCheck[0].project_name,
      });
    }

    if (nbdId) {
      const nbdCheck = await query(
        'SELECT id, nbd_id FROM projects WHERE nbd_id = ?',
        [nbdId]
      );
      if (nbdCheck.length > 0) {
        duplicateErrors.push(`NBD ID "${nbdId}" is already in use`);
        duplicateDetails.push({
          id: nbdCheck[0].id,
          nbd_id: nbdCheck[0].nbd_id,
        });
      }
    }

    if (projectCode) {
      const codeCheck = await query(
        'SELECT id, project_code FROM projects WHERE project_code = ?',
        [projectCode]
      );
      if (codeCheck.length > 0) {
        duplicateErrors.push(`Project code "${projectCode}" is already in use`);
        duplicateDetails.push({
          id: codeCheck[0].id,
          project_code: codeCheck[0].project_code,
        });
      }
    }

    if (pmsProjectId) {
      const pmsCheck = await query(
        'SELECT id, pms_project_id FROM projects WHERE pms_project_id = ?',
        [pmsProjectId]
      );
      if (pmsCheck.length > 0) {
        duplicateErrors.push(`PMS Project ID "${pmsProjectId}" is already in use`);
        duplicateDetails.push({
          id: pmsCheck[0].id,
          pms_project_id: pmsCheck[0].pms_project_id,
        });
      }
    }

    if (duplicateErrors.length > 0) {
      return res.status(409).json({
        message: 'Duplicate entry found',
        errors: duplicateErrors,
        details: duplicateDetails,
      });
    }

    // Insert new project
    const sql = `
      INSERT INTO projects
        (project_name, client_name, description, nbd_id, o2d_id,
         project_code, sub_category, start_date, end_date, status, 
         project_type, team_lead, pms_project_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const params = [
      name,
      clientName,
      description || null,
      nbdId || null,
      o2dId || null,
      projectCode || null,
      subCategory || null,
      startDate || null,
      endDate || null,
      status || 'New',
      projectType || null,
      teamLead || null,
      pmsProjectId || null,
    ];

    const result = await query(sql, params);

    const rows = await query(
      `SELECT id, project_name, client_name, description, nbd_id, o2d_id,
              project_code, sub_category, start_date, end_date, status, 
              project_type, team_lead, pms_project_id
       FROM projects WHERE id = ?`,
      [result.insertId]
    );

    return res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({
        message: 'Duplicate entry found',
        errors: ['A project with this name, NBD ID, PMS Project ID, or project code already exists'],
        details: [],
      });
    }
    return next(err);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/projects
// Returns all projects ordered by id ASC
// ─────────────────────────────────────────────────────────────────────────────
const getAllProjects = async (req, res, next) => {
  try {
    const sql = `
  SELECT
    p.id,
    p.project_name,
    p.client_name,
    p.description,
    p.nbd_id,
    p.o2d_id,
    p.project_code,
    p.sub_category,
    p.start_date,
    p.end_date,
    p.status,
    p.project_type,
    p.team_lead,
    p.create_cr,
    p.pms_project_id, -- New field
    COALESCE(SUM(e.total_hrs), 0) AS total_effort_hours,
    COALESCE(SUM(e.effort_days + e.buffer_days), 0) AS total_effort_days

  FROM projects p

  LEFT JOIN effort_estimates e
    ON e.project_id = p.id

  GROUP BY
    p.id,
    p.project_name,
    p.client_name,
    p.description,
    p.nbd_id,
    p.o2d_id,
    p.project_code,
    p.sub_category,
    p.start_date,
    p.end_date,
    p.status,
    p.project_type,
    p.team_lead,
    p.create_cr,
    p.pms_project_id -- New field

  ORDER BY p.id ASC
`;
    const projects = await query(sql);
    return res.status(200).json(projects);
  } catch (err) {
    return next(err);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/projects/:projectId/effort
// Returns all effort-estimate rows for a project (empty array if none yet)
// ─────────────────────────────────────────────────────────────────────────────
const getEffortEstimate = async (req, res, next) => {
  try {
    const { projectId } = req.params;

    const rows = await query(
      `SELECT id, project_id, role, effort_days, effort_hrs,
              buffer_days, buffer_hrs, total_hrs, units, unit_label
       FROM effort_estimates
       WHERE project_id = ?
       ORDER BY id ASC`,
      [projectId]
    );

    // Also return totals for convenience
    const totals = rows.reduce(
      (acc, r) => ({
        effort_days: acc.effort_days + Number(r.effort_days),
        effort_hrs:  acc.effort_hrs  + Number(r.effort_hrs),
        buffer_days: acc.buffer_days + Number(r.buffer_days),
        buffer_hrs:  acc.buffer_hrs  + Number(r.buffer_hrs),
        total_hrs:   acc.total_hrs   + Number(r.total_hrs),
      }),
      { effort_days: 0, effort_hrs: 0, buffer_days: 0, buffer_hrs: 0, total_hrs: 0 }
    );

    return res.status(200).json({ rows, totals });
  } catch (err) {
    return next(err);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/projects/:projectId/effort/bulk
// Body: { rows: [ { role, effort_days, buffer_days, units, unit_label }, … ] }
// Upserts all rows in one call (INSERT … ON DUPLICATE KEY UPDATE).
// The backend recalculates hrs and total_hrs from days so the frontend
// doesn't need to send derived values.
// ─────────────────────────────────────────────────────────────────────────────
const upsertEffortEstimate = async (req, res, next) => {
  try {
    const { projectId } = req.params;
    const { rows }      = req.body;

    if (!projectId || !Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ message: 'projectId and rows[] are required' });
    }

    // ── Check if any active task assignments exist for this project ───────
    const existingAssignments = await query(
      `SELECT 
         a.id, a.project_id, a.emp_id, a.role, a.task_name, 
         a.units_assigned, a.estimated_days, a.estimated_hours,
         COALESCE(e.emp_name, a.emp_id) AS user_name
       FROM assignments a
       LEFT JOIN master.emp e ON a.emp_id = e.emp_id
       WHERE a.project_id = ?`,
      [projectId]
    );

    if (existingAssignments.length > 0) {
      const assignmentsByRole = {};
      for (const a of existingAssignments) {
        if (!assignmentsByRole[a.role]) {
          assignmentsByRole[a.role] = [];
        }
        assignmentsByRole[a.role].push(a);
      }

      const blockedRoles = [];
      for (const [role, assignedList] of Object.entries(assignmentsByRole)) {
        const incomingRow = rows.find(r => r.role === role);
        const effortDays = incomingRow ? (parseFloat(incomingRow.effort_days) || 0) : 0;
        const bufferDays = incomingRow ? (parseFloat(incomingRow.buffer_days) || 0) : 0;
        const units = incomingRow ? (parseInt(incomingRow.units, 10) || 0) : 0;

        const totalAssignedUnits = assignedList.reduce((s, a) => s + (Number(a.units_assigned) || 0), 0);
        const totalAssignedDays = assignedList.reduce((s, a) => s + (Number(a.estimated_days) || 0), 0);
        const totalAssignedHours = assignedList.reduce((s, a) => s + (Number(a.estimated_hours) || 0), 0);

        const isRemoved = effortDays <= 0 || units <= 0;
        const isUnderAssigned = units < totalAssignedUnits || (effortDays + bufferDays) < totalAssignedDays;

        if (isRemoved || isUnderAssigned) {
          blockedRoles.push({
            role,
            reason: isRemoved ? 'removed' : 'under_assigned',
            assignedCount: assignedList.length,
            totalAssignedUnits,
            totalAssignedDays,
            totalAssignedHours,
            newUnits: units,
            newDays: effortDays,
            newBufferDays: bufferDays,
            assignments: assignedList.map(a => ({
              id: a.id,
              task_name: a.task_name,
              emp_id: a.emp_id,
              user_name: a.user_name,
              units_assigned: a.units_assigned,
              estimated_days: a.estimated_days,
              estimated_hours: a.estimated_hours,
            })),
          });
        }
      }

      if (blockedRoles.length > 0) {
        const roleNames = blockedRoles.map(b => `"${b.role}"`).join(', ');
        return res.status(400).json({
          message: `Cannot remove or reduce effort for ${roleNames} because active task assignments exist in Task Allocation. Please remove or update assignments first.`,
          blockedRoles,
        });
      }
    }

    const HOURS_PER_DAY = 8;

    for (const r of rows) {
      const effortDays = parseFloat(r.effort_days) || 0;
      const bufferDays = parseFloat(r.buffer_days) || 0;
      const effortHrs  = effortDays * HOURS_PER_DAY;
      const bufferHrs  = bufferDays * HOURS_PER_DAY;
      const totalHrs   = effortHrs + bufferHrs;

      await query(
        `INSERT INTO effort_estimates
           (project_id, role, effort_days, effort_hrs,
            buffer_days, buffer_hrs, total_hrs, units, unit_label)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           effort_days = VALUES(effort_days),
           effort_hrs  = VALUES(effort_hrs),
           buffer_days = VALUES(buffer_days),
           buffer_hrs  = VALUES(buffer_hrs),
           total_hrs   = VALUES(total_hrs),
           units       = VALUES(units),
           unit_label  = VALUES(unit_label),
           updated_at  = CURRENT_TIMESTAMP`,
        [
          projectId,
          r.role,
          effortDays,
          effortHrs,
          bufferDays,
          bufferHrs,
          totalHrs,
          (r.units !== undefined && r.units !== null && r.units !== '' && !isNaN(parseInt(r.units, 10))) ? parseInt(r.units, 10) : null,
          r.unit_label || null,
        ]
      );
    }

    // Return the freshly-saved data
    const saved = await query(
      `SELECT id, project_id, role, effort_days, effort_hrs,
              buffer_days, buffer_hrs, total_hrs, units, unit_label
       FROM effort_estimates WHERE project_id = ? ORDER BY id ASC`,
      [projectId]
    );

    const totals = saved.reduce(
      (acc, r) => ({
        effort_days: acc.effort_days + Number(r.effort_days),
        effort_hrs:  acc.effort_hrs  + Number(r.effort_hrs),
        buffer_days: acc.buffer_days + Number(r.buffer_days),
        buffer_hrs:  acc.buffer_hrs  + Number(r.buffer_hrs),
        total_hrs:   acc.total_hrs   + Number(r.total_hrs),
      }),
      { effort_days: 0, effort_hrs: 0, buffer_days: 0, buffer_hrs: 0, total_hrs: 0 }
    );

    return res.status(200).json({ message: 'Saved', rows: saved, totals });
  } catch (err) {
    return next(err);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/projects/:projectId/effort
// Wipes all effort rows for a project (useful for a "Reset" button)
// ─────────────────────────────────────────────────────────────────────────────
const deleteEffortEstimate = async (req, res, next) => {
  try {
    const { projectId } = req.params;

    const existingAssignments = await query(
      `SELECT a.id, a.role, a.task_name, a.units_assigned, a.emp_id, COALESCE(e.emp_name, a.emp_id) AS user_name
       FROM assignments a
       LEFT JOIN master.emp e ON a.emp_id = e.emp_id
       WHERE a.project_id = ?`,
      [projectId]
    );

    if (existingAssignments.length > 0) {
      return res.status(400).json({
        message: 'Cannot clear effort estimates because active task assignments exist for this project. Please remove assignments in Task Allocation first.',
        assignedCount: existingAssignments.length,
      });
    }

    await query('DELETE FROM effort_estimates WHERE project_id = ?', [projectId]);
    return res.status(200).json({ message: 'Effort estimate cleared' });
  } catch (err) {
    return next(err);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/projects/:id
// Body: { name, clientName, description, nbdId, o2dId, projectCode,
//         subCategory, startDate, endDate, status, projectType }
// ─────────────────────────────────────────────────────────────────────────────
const updateProject = async (req, res, next) => {
  try {
    const { id } = req.params;
    const {
      name,
      clientName,
      description,
      nbdId,
      o2dId,
      projectCode,
      subCategory,
      startDate,
      endDate,
      status,
      projectType,
      teamLead,
      createCr,
    } = req.body;

    // Check if project exists
    const projectExists = await query('SELECT id FROM projects WHERE id = ?', [id]);
    if (!projectExists.length) {
      return res.status(404).json({ message: 'Project not found' });
    }

    const current = (await query('SELECT * FROM projects WHERE id = ?', [id]))[0];

    // Prepare updated values
    const updatedName = name !== undefined ? name : current.project_name;
    const updatedClientName = clientName !== undefined ? clientName : current.client_name;
    const updatedDescription = description !== undefined ? description : current.description;
    const updatedNbdId = nbdId !== undefined ? nbdId : current.nbd_id;
    const updatedO2dId = o2dId !== undefined ? o2dId : current.o2d_id;
    const updatedProjectCode = projectCode !== undefined ? projectCode : current.project_code;
    const updatedSubCategory = subCategory !== undefined ? subCategory : current.sub_category;
    const updatedStartDate = startDate !== undefined ? startDate : current.start_date;
    const updatedEndDate = endDate !== undefined ? endDate : current.end_date;
    const updatedStatus = status !== undefined ? status : current.status;
    const updatedProjectType = projectType !== undefined ? projectType : current.project_type;
    const updatedTeamLead = teamLead !== undefined ? teamLead : current.team_lead;
    const updatedCreateCr = createCr !== undefined ? createCr : current.create_cr;

    if (updatedStartDate && updatedEndDate && new Date(updatedEndDate) < new Date(updatedStartDate)) {
      return res.status(400).json({
        message: 'End date cannot be earlier than start date',
      });
    }

    // ─── Check for duplicates (excluding current project) ────────────────
    const duplicateErrors = [];
    const duplicateDetails = [];

    // ─── ADD THIS DUPLICATE CHECK ─────────────────────────────────────────
    // Check sub_category
    if (updatedSubCategory && updatedSubCategory !== current.sub_category) {
      const subCategoryCheck = await query(
        'SELECT id, sub_category FROM projects WHERE sub_category = ? AND id != ?',
        [updatedSubCategory, id]
      );
      if (subCategoryCheck.length > 0) {
        duplicateErrors.push(`Sub Category "${updatedSubCategory}" is already in use`);
        duplicateDetails.push({
          id: subCategoryCheck[0].id,
          sub_category: subCategoryCheck[0].sub_category,
        });
      }
    }

    // Check project_name
    if (updatedName && updatedName !== current.project_name) {
      const nameCheck = await query(
        'SELECT id, project_name FROM projects WHERE project_name = ? AND id != ?',
        [updatedName, id]
      );
      if (nameCheck.length > 0) {
        duplicateErrors.push(`Project name "${updatedName}" is already in use`);
        duplicateDetails.push({
          id: nameCheck[0].id,
          project_name: nameCheck[0].project_name,
        });
      }
    }

    // Check nbd_id
    if (updatedNbdId && updatedNbdId !== current.nbd_id) {
      const nbdCheck = await query(
        'SELECT id, nbd_id FROM projects WHERE nbd_id = ? AND id != ?',
        [updatedNbdId, id]
      );
      if (nbdCheck.length > 0) {
        duplicateErrors.push(`NBD ID "${updatedNbdId}" is already in use`);
        duplicateDetails.push({
          id: nbdCheck[0].id,
          nbd_id: nbdCheck[0].nbd_id,
        });
      }
    }

    // Check project_code
    // if (updatedProjectCode && updatedProjectCode !== current.project_code) {
    //   const codeCheck = await query(
    //     'SELECT id, project_code FROM projects WHERE project_code = ? AND id != ?',
    //     [updatedProjectCode, id]
    //   );
    //   if (codeCheck.length > 0) {
    //     duplicateErrors.push(`Project code "${updatedProjectCode}" is already in use`);
    //     duplicateDetails.push({
    //       id: codeCheck[0].id,
    //       project_code: codeCheck[0].project_code,
    //     });
    //   }
    // }

    // If any duplicates found, return error
    if (duplicateErrors.length > 0) {
      return res.status(409).json({
        message: 'Duplicate entry found',
        errors: duplicateErrors,
        details: duplicateDetails,
      });
    }

    // ─── Update project ────────────────────────────────────────────────────
    const updateSql = `
      UPDATE projects
      SET
        project_name = ?,
        client_name = ?,
        description = ?,
        nbd_id = ?,
        o2d_id = ?,
        project_code = ?,
        sub_category = ?,
        start_date = ?,
        end_date = ?,
        status = ?,
        project_type = ?,
        team_lead = ?,
        create_cr = ?
      WHERE id = ?
    `;

    await query(updateSql, [
      updatedName,
      updatedClientName,
      updatedDescription,
      updatedNbdId,
      updatedO2dId,
      updatedProjectCode,
      updatedSubCategory,
      updatedStartDate,
      updatedEndDate,
      updatedStatus,
      updatedProjectType,
      updatedTeamLead,
      updatedCreateCr,
      id,
    ]);

    const updatedRows = await query(
      `SELECT id, project_name, client_name, description, nbd_id, o2d_id,
              project_code, sub_category, start_date, end_date, status, 
              project_type, team_lead, create_cr
       FROM projects WHERE id = ?`,
      [id]
    );

    return res.status(200).json(updatedRows[0]);
  } catch (err) {
    // Handle any unexpected MySQL errors
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({
        message: 'Duplicate entry found',
        errors: ['A project with this name or NBD ID already exists'],
        details: [],
      });
    }
    return next(err);
  }
};
// ─────────────────────────────────────────────────────────────────────────────
// GET /api/projects/customers (or /api/customers)
// Returns deduplicated list of customers from project_codes table (or projects fallback)
// ─────────────────────────────────────────────────────────────────────────────
const getCustomers = async (req, res, next) => {
  try {
    let allCustomers = [];

    const customerQueries = [
      () =>
        projectCodeQuery(`
          SELECT customer_name
          FROM project_codes_import
          WHERE customer_name IS NOT NULL AND TRIM(customer_name) != ''
        `),

      () =>
        projectCodeQuery(`
          SELECT customer_name
          FROM project_codes
          WHERE customer_name IS NOT NULL AND TRIM(customer_name) != ''
        `),

      () =>
        query(`
          SELECT customer_name
          FROM project_codes_db.project_codes_import
          WHERE customer_name IS NOT NULL AND TRIM(customer_name) != ''
        `),

      () =>
        query(`
          SELECT customer_name
          FROM project_codes_db.project_codes_internal_import
          WHERE customer_name IS NOT NULL AND TRIM(customer_name) != ''
        `),

      () =>
        query(`
          SELECT customer_name
          FROM project_codes_db.project_codes
          WHERE customer_name IS NOT NULL AND TRIM(customer_name) != ''
        `),
    ];

    // Fetch customer names from all 5 tables
    for (const runQuery of customerQueries) {
      try {
        const rows = await runQuery();
        allCustomers.push(...rows);
      } catch (err) {
        console.log("Skipping table:", err.message);
      }
    }

    // Remove duplicates, nulls, empty values, and sort
    const uniqueCustomers = [
      ...new Set(
        allCustomers
          .map((row) => row.customer_name?.trim())
          .filter(Boolean)
      ),
    ].sort((a, b) => a.localeCompare(b));

    // Format response for frontend dropdown
    const formatted = uniqueCustomers.map((name, index) => ({
      id: index + 1,
      customer_name: name,
      name,
    }));

    return res.status(200).json(formatted);
  } catch (err) {
    return next(err);
  }
};

// ============================================
// 1. FETCH PMS PROJECTS (for dropdown - simplified)
// ============================================
const fetchPMSProjects = async (req, res, next) => {
  try {
    console.log('📥 Fetching PMS projects for dropdown...');
    console.log('📋 Using Authorization:', req.headers.authorization ? '✅ Present' : '❌ Missing');
    
    const response = await axios.get(
      `${PMS_CONFIG.baseUrl}/api/pms/getAllProjects`,
      {
        headers: getPMSHeaders(req),
        timeout: PMS_CONFIG.timeout
      }
    );
    
    let projects = [];
    if (Array.isArray(response.data)) {
      projects = response.data;
    } else if (response.data && Array.isArray(response.data.projects)) {
      projects = response.data.projects;
    } else if (response.data && Array.isArray(response.data.data)) {
      projects = response.data.data;
    } else {
      return res.status(200).json([]);
    }

    const formattedProjects = projects.map(project => ({
      pms_project_id: project.project_id || project.id,
      title: project.project_title || project.title || project.name || '',
    }));
    
    return res.status(200).json(formattedProjects);
  } catch (err) {
    console.error('❌ Error fetching PMS projects:', err.message);
    return res.status(500).json({
      message: 'Failed to fetch PMS projects',
      error: err.message
    });
  }
};
// API to fetch project details from PMS including milestones and tasks
const fetchPMSProjectDetails = async (req, res, next) => {
  try {
    const { projectId } = req.query;
    
    if (!projectId) {
      return res.status(400).json({
        message: 'Project ID is required'
      });
    }

    // First, check if the project exists in your DB
    const localProject = await query(
      'SELECT id, project_name, pms_project_id FROM projects WHERE pms_project_id = ?',
      [projectId]
    );

    if (localProject.length === 0) {
      return res.status(404).json({
        message: 'Project not found in quantify tool'
      });
    }

    // ✅ FIX: Forward the authorization token to PMS
    const authHeader = req.headers.authorization;
    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    };
    
    if (authHeader) {
      headers['Authorization'] = authHeader;
      console.log('✅ Forwarding authorization token to PMS');
    } else {
      console.warn('⚠️ No authorization header found in request');
    }

    // Fetch from PMS with token
    const response = await axios.get(
      `http://172.16.20.61:5001/api/pms/getProjectDetails?projectId=${projectId}`,
      { 
        headers: headers,
        timeout: 10000 
      }
    );

    if (response.data) {
      // Structure the response for FE
      const projectDetails = {
        project_id: localProject[0].id,
        project_name: localProject[0].project_name,
        pms_project_id: projectId,
        milestones: response.data.milestoneDetails || response.data.milestones || [],
        tasks: response.data.tasksDetails || response.data.tasks || []
      };

      return res.status(200).json(projectDetails);
    } else {
      return res.status(404).json({
        message: 'Project details not found in PMS'
      });
    }
  } catch (err) {
    console.error('Error fetching PMS project details:', err.message);
    
    // Better error handling
    if (err.response) {
      console.error('PMS API Response Status:', err.response.status);
      console.error('PMS API Response Data:', err.response.data);
      
      if (err.response.status === 401) {
        return res.status(401).json({
          message: 'Authentication failed with PMS API',
          error: 'Invalid or expired token'
        });
      }
    }
    
    return res.status(500).json({
      message: 'Failed to fetch project details from PMS',
      error: err.message
    });
  }
};
module.exports = {
  createProject,
  getAllProjects,
  getEffortEstimate,
  upsertEffortEstimate,
  deleteEffortEstimate,
  updateProject,
  getCustomers,
  fetchPMSProjects,
  fetchPMSProjectDetails,
};