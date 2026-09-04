const { query, masterQuery } = require('../config/db');


//POST/api/daily-updates
const addDailyUpdate = async (req, res, next) => {
  try {
    let {
      project_id, role, task_name, user_id, date,
      units_completed, hours_spent, remarks,
      todays_task, tomorrows_plan, risk_level, risk_description
    } = req.body;

    if (!user_id || user_id === "null" || user_id === "undefined") {
      const empId = req.user?.emp_id;
      if (empId) {
        const rows = await query("SELECT id FROM users WHERE emp_id = ?", [empId]);
        if (rows && rows.length > 0) {
          user_id = rows[0].id;
          console.log(`ℹ️ Resolved user_id for addDailyUpdate from token: ${user_id}`);
        }
      }
    }

    if (!project_id || !role || !task_name || !user_id || !date) {
      return res.status(400).json({
        message: "Project, Role, Task, User and Date are required"
      });
    }

    // Validate risk_level if provided
    const validRiskLevels = ['Low', 'Medium', 'High'];
    if (risk_level && !validRiskLevels.includes(risk_level)) {
      return res.status(400).json({ message: "risk_level must be Low, Medium or High" });
    }

    const insertSql = `
      INSERT INTO daily_updates
      (project_id, role, task_name, user_id, date,
       units_completed, hours_spent, remarks,
       todays_task, tomorrows_plan, risk_level, risk_description)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const insertParams = [
      project_id, role, task_name, user_id, date,
      parseInt(units_completed, 10) || 0,
      hours_spent || 0,
      remarks || null,
      todays_task || null,
      tomorrows_plan || null,
      risk_level || null,
      risk_description || null
    ];

    const result = await query(insertSql, insertParams);
    const insertedId = result.insertId;

    const selectSql = `
      SELECT 
        du.id, du.project_id, p.project_name,
        du.role, du.task_name, du.user_id,
        du.date, du.units_completed, du.hours_spent, du.remarks,
        du.todays_task, du.tomorrows_plan,
        du.risk_level, du.risk_description
      FROM daily_updates du
      LEFT JOIN projects p ON du.project_id = p.id
      WHERE du.id = ?
    `;

    const rows = await query(selectSql, [insertedId]);
    return res.status(201).json(rows[0]);

  } catch (err) {
    return next(err);
  }
};

// GET/api/daily-updates?userId=
const getDailyUpdatesByUserId = async (req, res, next) => {
  try {
    let { userId } = req.query;

    if (!userId || userId === "null" || userId === "undefined") {
      const empId = req.user?.emp_id;
      if (empId) {
        const rows = await query("SELECT id FROM users WHERE emp_id = ?", [empId]);
        if (rows && rows.length > 0) {
          userId = rows[0].id;
          console.log(`ℹ️ Resolved userId for getDailyUpdatesByUserId from token: ${userId}`);
        }
      }
    }

    const sql = `
      SELECT 
        du.id, du.project_id, p.project_name,
        du.role, du.task_name, du.user_id,
        du.date, du.units_completed, du.hours_spent, du.remarks,
        du.todays_task, du.tomorrows_plan,
        du.risk_level, du.risk_description
      FROM daily_updates du
      LEFT JOIN projects p ON du.project_id = p.id
      WHERE du.user_id = ?
      ORDER BY du.date DESC, du.id DESC
    `;

    const updates = await query(sql, [userId]);
    return res.status(200).json(updates);

  } catch (err) {
    return next(err);
  }
};

// GET /api/daily-updates/all — Admin: all updates across all employees (for dashboard)
const getAllDailyUpdates = async (req, res, next) => {
  try {
    const { projectId, riskLevel, dateFrom, dateTo } = req.query;

    let sql = `
      SELECT 
        du.id, du.project_id, p.project_name,
        du.role, du.task_name,
        du.user_id, u.name AS user_name,
        du.date, du.units_completed, du.hours_spent, du.remarks,
        du.todays_task, du.tomorrows_plan,
        du.risk_level, du.risk_description
      FROM daily_updates du
      LEFT JOIN projects p ON du.project_id = p.id
      LEFT JOIN users u ON du.user_id = u.id
      WHERE 1=1
    `;
    const params = [];

    if (projectId) {
      sql += ` AND du.project_id = ?`;
      params.push(projectId);
    }
    if (riskLevel) {
      sql += ` AND du.risk_level = ?`;
      params.push(riskLevel);
    }
    if (dateFrom) {
      sql += ` AND du.date >= ?`;
      params.push(dateFrom);
    }
    if (dateTo) {
      sql += ` AND du.date <= ?`;
      params.push(dateTo);
    }

    sql += ` ORDER BY du.date DESC, du.id DESC`;

    const updates = await query(sql, params);
    return res.status(200).json(updates);

  } catch (err) {
    return next(err);
  }
};

// PUT /api/daily-updates/:id
const updateDailyUpdate = async (req, res, next) => {
  try {
    const { id } = req.params;
    const {
      project_id, role, task_name, date,
      units_completed, hours_spent, remarks,
      todays_task, tomorrows_plan, risk_level, risk_description
    } = req.body;

    // Validate risk_level if provided
    const validRiskLevels = ['Low', 'Medium', 'High'];
    if (risk_level && !validRiskLevels.includes(risk_level)) {
      return res.status(400).json({ message: "risk_level must be Low, Medium or High" });
    }

    const sql = `
      UPDATE daily_updates
      SET project_id = ?, role = ?, task_name = ?,
          date = ?, units_completed = ?, hours_spent = ?, remarks = ?,
          todays_task = ?, tomorrows_plan = ?,
          risk_level = ?, risk_description = ?
      WHERE id = ?
    `;

    await query(sql, [
      project_id, role, task_name, date,
      parseInt(units_completed, 10) || 0, hours_spent, remarks,
      todays_task || null,
      tomorrows_plan || null,
      risk_level || null,
      risk_description || null,
      id
    ]);

    res.json({ message: "Updated successfully" });
  } catch (err) {
    next(err);
  }
};

// DELETE /api/daily-updates/:id
const deleteDailyUpdate = async (req, res, next) => {
  try {
    const { id } = req.params;
    await query("DELETE FROM daily_updates WHERE id = ?", [id]);
    res.json({ message: "Daily update deleted successfully" });
  } catch (err) {
    next(err);
  }
};



// GET /api/daily-updates/meta
async function getMeta(req, res) {
  try {
    console.log('🚀 getMeta called - Admin/Manager view');
    
    // Generate all dates from Jan 1, 2025 to today
    const today = new Date();
    const startDate = new Date("2025-01-01");
    const dates = [];
    
    for (let d = new Date(startDate); d <= today; d.setDate(d.getDate() + 1)) {
      dates.push(d.toISOString().split("T")[0]);
    }
    dates.sort((a, b) => new Date(b) - new Date(a));

    // Get ALL projects
    const projects = await query(`
      SELECT id, project_name
      FROM projects
      ORDER BY project_name
    `);

    res.status(200).json({
      success: true,
      dates: dates,
      projects: projects
    });

  } catch (err) {
    console.error('❌ getMeta error:', err);
    res.status(500).json({
      success: false,
      error: "Failed to load filter options",
      details: err.message
    });
  }
}

// GET /api/daily-updates/employee-projects - For Employees (assigned projects only)
async function getEmployeeProjects(req, res) {
  try {
    const userId = req.user?.emp_id;
    const userRole = req.user?.role;
    
    console.log('👤 getEmployeeProjects called for:', { userId, userRole });
    
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: "User not authenticated"
      });
    }
    
    // ✅ Query based on your actual table structure (no status column)
    const projects = await query(`
      SELECT DISTINCT p.id, p.project_name
      FROM projects p
      INNER JOIN assignments a ON a.project_id = p.id
      WHERE a.emp_id = ?
      ORDER BY p.project_name
    `, [userId]);
    
    console.log(`📋 Found ${projects.length} assigned projects for employee ${userId}`);
    
    res.status(200).json({
      success: true,
      projects: projects
    });
  } catch (err) {
    console.error('❌ getEmployeeProjects error:', err);
    res.status(500).json({
      success: false,
      error: "Failed to load employee projects",
      details: err.message
    });
  }
}

// GET /api/daily-updates/report
async function getDailyUpdates(req, res) {
  const { date, project_id, user_id } = req.query;

  const conditions = [];
  const params = [];

  if (date) {
    conditions.push("ap.date = ?");
    params.push(date);
  }

  if (project_id) {
    conditions.push("ap.project_id = ?");
    params.push(project_id);
  }

  if (user_id) {
    conditions.push("ap.emp_id = ?");
    params.push(user_id);
  }

  const whereClause = conditions.length
    ? `WHERE ${conditions.join(" AND ")}`
    : "";

  // ✅ Updated query with estimated_hours from assignments
  const sql = `
    SELECT
      ap.id,
      ap.date,
      ap.emp_id,
      e.emp_name AS employee_name,
      e.emp_email AS employee_email,
      e.emp_id,
      e.u_id,
      e.flag AS employee_status,

      ap.project_id,
      p.project_name,

      ap.role,
      ap.task_name,

      ap.status AS working_status,

      ap.units_completed,
      ap.total_time_needed,

      -- ✅ Get estimated_hours from assignments table
      (
        SELECT estimated_hours 
        FROM assignments a
        WHERE a.emp_id = ap.emp_id
          AND a.project_id = ap.project_id
          AND a.task_name = ap.task_name
        LIMIT 1
      ) AS estimated_hours,

      ap.yesterdays_tasks AS done_yesterday,
      ap.todays_tasks,

      ap.risks,
      ap.remarks,
      ap.availability,

      -- Get previous day's todays_tasks as previousDayPlan
      (
        SELECT todays_tasks 
        FROM assignment_progress ap_prev
        WHERE ap_prev.emp_id = ap.emp_id
          AND ap_prev.project_id = ap.project_id
          AND ap_prev.task_name = ap.task_name
          AND ap_prev.date = DATE_SUB(ap.date, INTERVAL 1 DAY)
        LIMIT 1
      ) AS previousDayPlan

    FROM assignment_progress ap

    LEFT JOIN master.emp e
      ON e.emp_id = ap.emp_id

    LEFT JOIN projects p
      ON p.id = ap.project_id

    ${whereClause}

    ORDER BY e.emp_name, p.project_name, ap.task_name
  `;

  try {
    console.log('📊 Fetching daily updates');
    const rows = await query(sql, params);
    console.log(`✅ Found ${rows.length} updates`);
    
    res.status(200).json({
      success: true,
      data: rows
    });
  } catch (err) {
    console.error('❌ getDailyUpdates error:', err);
    res.status(500).json({
      success: false,
      error: "Failed to load daily updates",
      details: err.message
    });
  }
}


module.exports = {
  addDailyUpdate,
  getDailyUpdatesByUserId,
  getAllDailyUpdates,
  updateDailyUpdate,
  deleteDailyUpdate,
  getMeta, getDailyUpdates,
  getEmployeeProjects
};