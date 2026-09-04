const { query, masterQuery } = require("../config/db");
const { createNotification } = require("./notification.controller");

const resolveLocalUserId = async (empId, empName, empEmail) => {
  // 1. Try to match by emp_id in local users
  if (empId) {
    const rows = await query("SELECT id FROM users WHERE emp_id = ?", [empId]);
    if (rows.length > 0) return rows[0].id;
  }

  // 2. Try to match by email
  if (empEmail) {
    const rows = await query("SELECT id FROM users WHERE email = ?", [empEmail]);
    if (rows.length > 0) {
      // Self-heal: update emp_id
      if (empId) {
        await query("UPDATE users SET emp_id = ? WHERE id = ?", [empId, rows[0].id]);
      }
      return rows[0].id;
    }
  }

  // 3. Try to match by cleaning name (ignore salutations, spaces, punctuation)
  if (empName) {
    const clean = (n) => {
      if (!n) return "";
      return n
        .replace(/^(Mr\.|Ms\.|Mrs\.|Dr\.)\s+/i, "")
        .replace(/[^a-zA-Z0-9]/g, "")
        .toLowerCase();
    };
    const targetCleaned = clean(empName);
    
    const allUsers = await query("SELECT id, name, email FROM users");
    for (const u of allUsers) {
      if (clean(u.name) === targetCleaned) {
        // Self-heal: update emp_id
        if (empId) {
          await query("UPDATE users SET emp_id = ? WHERE id = ?", [empId, u.id]);
        }
        return u.id;
      }
    }
  }

  return null;
};

// GET /api/assignments/catalog
const getCatalog = async (req, res, next) => {
  try {
    const rows = await query(`SELECT id, role, task_name, unit_type, notes FROM role_task_catalog ORDER BY role, id`);
    const grouped = {};
    for (const row of rows) {
      if (!grouped[row.role]) grouped[row.role] = [];
      grouped[row.role].push(row);
    }
    return res.status(200).json({ flat: rows, grouped });
  } catch (err) { return next(err); }
};

// GET /api/assignments/effort-estimates/:projectId
// Fetches role-level effort data from effort_estimates table
const getEffortEstimates = async (req, res, next) => {
  try {
    const { projectId } = req.params;
    const rows = await query(
      `SELECT 
         id, project_id, role,
         effort_days, effort_hrs,
         buffer_days, buffer_hrs,
         total_hrs, units, unit_label
       FROM effort_estimates
       WHERE project_id = ?
       ORDER BY role`,
      [projectId]
    );
    // Key by role for easy frontend lookup
    const byRole = {};
    for (const row of rows) {
      byRole[row.role] = row;
    }
    return res.status(200).json({ estimates: rows, byRole });
  } catch (err) { return next(err); }
};

// GET /api/assignments/task-loads/:projectId
// Now includes estimated_days and estimated_hours per task
const getTaskLoads = async (req, res, next) => {
  try {
    const { projectId } = req.params;
    const rows = await query(
  `SELECT
      ptl.id,
      ptl.project_id,
      ptl.role,
      ptl.task_name,
      ptl.planned_units,
      ptl.estimated_days,
      ptl.estimated_hours,

      ee.effort_days,
      ee.effort_hrs,

      rtc.unit_type,
      rtc.notes

   FROM project_task_loads ptl

   LEFT JOIN role_task_catalog rtc
     ON ptl.role = rtc.role
    AND ptl.task_name = rtc.task_name

   LEFT JOIN effort_estimates ee
     ON ee.project_id = ptl.project_id
    AND ee.role = ptl.role

   WHERE ptl.project_id = ?

   ORDER BY ptl.role, ptl.task_name`,
  [projectId]
);
    const total = rows.reduce((s, r) => s + Number(r.planned_units), 0);
    // const totalEstHours = rows.reduce((s, r) => s + Number(r.estimated_hours || 0), 0);
    const totalEstHours = rows.reduce((s, r) => s + Number(r.effort_hrs || 0), 0);
    return res.status(200).json({ 
      loads: rows, 
      total_load: total,
      total_estimated_hours: totalEstHours
    });
  } catch (err) { return next(err); }
};

// POST /api/assignments/task-loads (single upsert)
// Now supports estimated_days and estimated_hours
const upsertTaskLoad = async (req, res, next) => {
  try {
    const { project_id, role, task_name, planned_units } = req.body;

    if (!project_id || !role || !task_name) {
      return res.status(400).json({
        message: "project_id, role, task_name required"
      });
    }

    await query(
      `INSERT INTO project_task_loads
       (project_id, role, task_name, planned_units)
       VALUES (?, ?, ?, ?)

       ON DUPLICATE KEY UPDATE
       planned_units = VALUES(planned_units)`,
      [
        project_id,
        role,
        task_name,
        planned_units || 0
      ]
    );

    return res.status(200).json({
      message: "Saved"
    });

  } catch (err) {
    return next(err);
  }
};

// POST /api/assignments/task-loads/bulk
// Now supports estimated_days and estimated_hours per task
const bulkUpsertTaskLoads = async (req, res, next) => {
  try {
    const { project_id, loads } = req.body;

    if (!project_id || !Array.isArray(loads)) {
      return res.status(400).json({
        message: "project_id and loads[] required"
      });
    }

    for (const load of loads) {
      // await query(
      //   `INSERT INTO project_task_loads
      //    (project_id, role, task_name, planned_units)
      //    VALUES (?, ?, ?, ?)

      //    ON DUPLICATE KEY UPDATE
      //    planned_units = VALUES(planned_units)`,
      //   [
      //     project_id,
      //     load.role,
      //     load.task_name,
      //     load.planned_units || 0
      //   ]
      // );
    await query(
  `INSERT INTO project_task_loads
   (
     project_id,
     role,
     task_name,
     planned_units,
     estimated_days,
     estimated_hours
   )
   VALUES (?, ?, ?, ?, ?, ?)

   ON DUPLICATE KEY UPDATE
   planned_units   = VALUES(planned_units),
   estimated_days = VALUES(estimated_days),
   estimated_hours = VALUES(estimated_hours)`,
  [
    project_id,
    load.role,
    load.task_name,
    load.planned_units !== undefined && load.planned_units !== null && load.planned_units !== '' ? parseInt(load.planned_units, 10) : 0,
    load.estimated_days || 0,
    load.estimated_hours || 0
  ]
);
    }

    const rows = await query(
      `SELECT
          ptl.*,
          rtc.unit_type

       FROM project_task_loads ptl

       LEFT JOIN role_task_catalog rtc
         ON ptl.role = rtc.role
        AND ptl.task_name = rtc.task_name

       WHERE ptl.project_id = ?`,
      [project_id]
    );

    return res.status(200).json({
      loads: rows,
      total_load: rows.reduce(
        (s, r) => s + Number(r.planned_units),
        0
      )
    });

  } catch (err) {
    return next(err);
  }
};

// GET /api/assignments/summary/:projectId
const getProjectSummary = async (req, res, next) => {
  try {
    const { projectId } = req.params;
    const [rows, effortEst] = await Promise.all([
      query(
        `SELECT
            ptl.role,
            ptl.task_name,
            ptl.planned_units,
      
            ee.effort_days,
            ee.effort_hrs,
      
            rtc.unit_type,
      
            COALESCE(SUM(a.units_assigned), 0) AS total_assigned,
      
            COALESCE(SUM(ap_t.units_completed), 0) AS total_completed,
      
            GREATEST(
              ptl.planned_units -
              COALESCE(SUM(a.units_assigned), 0),
              0
            ) AS unassigned,
      
            GREATEST(
              COALESCE(SUM(a.units_assigned), 0) -
              COALESCE(SUM(ap_t.units_completed), 0),
              0
            ) AS pending
      
         FROM project_task_loads ptl
      
         LEFT JOIN effort_estimates ee
           ON ee.project_id = ptl.project_id
          AND ee.role = ptl.role
      
         LEFT JOIN role_task_catalog rtc
           ON ptl.role = rtc.role
          AND ptl.task_name = rtc.task_name
      
         LEFT JOIN assignments a
           ON a.project_id = ptl.project_id
          AND a.role = ptl.role
          AND a.task_name = ptl.task_name
      
         LEFT JOIN (
            SELECT
              assignment_id,
              SUM(units_completed) AS units_completed
            FROM assignment_progress
            GROUP BY assignment_id
         ) ap_t
           ON ap_t.assignment_id = a.id
      
         WHERE ptl.project_id = ?
      
         GROUP BY
            ptl.role,
            ptl.task_name,
            ptl.planned_units,
            ee.effort_days,
            ee.effort_hrs,
            rtc.unit_type
      
         ORDER BY
            ptl.role,
            ptl.task_name`,
        [projectId]
      ),
      query(
        `SELECT COALESCE(SUM(effort_days), 0) AS total_days, COALESCE(SUM(effort_hrs), 0) AS total_hours
         FROM effort_estimates
         WHERE project_id = ?`,
        [projectId]
      )
    ]);

    const totalEffortDays = Number(effortEst[0]?.total_days || 0);
    const totalEffortHours = Number(effortEst[0]?.total_hours || 0);

    const totals = {
      total_planned: rows.reduce(
        (s, r) => s + Number(r.planned_units),
        0
      ),
    
      total_effort_days: totalEffortDays,
    
      total_effort_hours: totalEffortHours,
    
      total_assigned: rows.reduce(
        (s, r) => s + Number(r.total_assigned),
        0
      ),
    
      total_completed: rows.reduce(
        (s, r) => s + Number(r.total_completed),
        0
      ),
    
      total_pending: rows.reduce(
        (s, r) => s + Number(r.pending),
        0
      )
    };
    return res.status(200).json({ rows, totals });
  } catch (err) { return next(err); }
};

// GET /api/assignments?projectId= (UPDATED: Uses master.emp)
const getAssignmentsByProject = async (req, res, next) => {
  try {
    const { projectId } = req.query;

    if (!projectId) {
      return res.status(400).json({
        message: "projectId required"
      });
    }

    const rows = await query(
      `SELECT 
          a.id,
          a.project_id,
          p.project_name,
          a.user_id,
          a.emp_id,
          e.emp_name AS user_name,  -- ✅ From master.emp
          a.role,
          a.task_name,
          a.units_assigned,
          a.estimated_days,
          a.estimated_hours,

          COALESCE(SUM(ap.units_completed), 0) AS units_completed,

          ee.effort_days,
          ee.effort_hrs,
          ee.buffer_days,
          ee.buffer_hrs,
          ee.total_hrs,
          ee.units,
          ee.unit_label

       FROM assignments a

       LEFT JOIN master.emp e      -- ✅ Replaced users table
         ON a.emp_id = e.emp_id

       LEFT JOIN projects p
         ON a.project_id = p.id

       LEFT JOIN effort_estimates ee
         ON ee.project_id = a.project_id
         AND ee.role = a.role

       LEFT JOIN assignment_progress ap
         ON ap.assignment_id = a.id

       WHERE a.project_id = ?

       GROUP BY
         a.id, a.project_id, p.project_name, a.user_id, a.emp_id,
         e.emp_name, a.role, a.task_name, a.units_assigned,
         a.estimated_days, a.estimated_hours,
         ee.effort_days, ee.effort_hrs, ee.buffer_days,
         ee.buffer_hrs, ee.total_hrs, ee.units, ee.unit_label

       ORDER BY a.role, e.emp_name`,
      [projectId]
    );

    return res.status(200).json(rows);

  } catch (err) {
    return next(err);
  }
};
// GET /api/assignment/employee-assignment

async function getEmployeeAssignments(req, res) {
  try {
    const { emp_id } = req.query;

    if (!emp_id) {
      return res.status(400).json({
        success: false,
        message: "emp_id is required"
      });
    }

    // ✅ Get employee details from master.emp
    const employee = await masterQuery(
      `SELECT u_id, emp_id, emp_name, emp_email, flag as status 
       FROM emp WHERE emp_id = ? AND flag = 'Active'`,
      [emp_id]
    );

    if (employee.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Employee not found"
      });
    }

    // ✅ Get ALL assigned tasks (including not started)
    const assignments = await query(
      `SELECT 
         a.id as assignment_id,
         a.project_id,
         p.project_name,
         a.role,
         a.task_name,
         a.units_assigned,
         a.estimated_hours,
         a.estimated_days,
         COALESCE(SUM(ap.units_completed), 0) AS units_completed,
         GREATEST(a.units_assigned - COALESCE(SUM(ap.units_completed), 0), 0) AS units_pending
       FROM assignments a
       LEFT JOIN projects p ON a.project_id = p.id
       LEFT JOIN assignment_progress ap ON a.id = ap.assignment_id
       WHERE a.emp_id = ?
       GROUP BY a.id, a.project_id, p.project_name, a.role, a.task_name, a.units_assigned, a.estimated_hours, a.estimated_days
       HAVING units_pending > 0  -- ✅ Show all tasks that are not fully completed
       ORDER BY p.project_name, a.role, a.task_name`,
      [emp_id]
    );

    // If no tasks, return empty
    if (assignments.length === 0) {
      return res.status(200).json({
        success: true,
        data: {
          employee: employee[0],
          summary: {
            total_tasks: 0,
            total_assigned_hours: 0,
            total_completed_hours: 0,
            total_pending_hours: 0
          },
          tasks: []
        }
      });
    }

    // ✅ Process tasks and categorize them
    const projectsMap = {};
    let totalAssignedHours = 0;
    let totalCompletedHours = 0;
    let totalPendingHours = 0;
    let totalNotStarted = 0;
    let totalInProgress = 0;

    assignments.forEach(assignment => {
      const projectId = assignment.project_id;
      if (!projectsMap[projectId]) {
        projectsMap[projectId] = {
          project_id: projectId,
          project_name: assignment.project_name || 'Unknown Project',
          total_assigned_hours: 0,
          total_completed_hours: 0,
          total_pending_hours: 0,
          tasks: []
        };
      }
      
      const assignedHours = assignment.estimated_hours || (assignment.estimated_days * 8) || 0;
      const completionRatio = assignment.units_assigned > 0 
        ? assignment.units_completed / assignment.units_assigned 
        : 0;
      const completedHours = assignedHours * completionRatio;
      const pendingHours = assignedHours - completedHours;
      
      // ✅ Determine task status
      let taskStatus = 'not_started';
      if (assignment.units_completed > 0 && assignment.units_pending > 0) {
        taskStatus = 'in_progress';
        totalInProgress++;
      } else if (assignment.units_completed === 0 && assignment.units_pending > 0) {
        taskStatus = 'not_started';
        totalNotStarted++;
      }
      
      projectsMap[projectId].total_assigned_hours += assignedHours;
      projectsMap[projectId].total_completed_hours += completedHours;
      projectsMap[projectId].total_pending_hours += pendingHours;
      
      totalAssignedHours += assignedHours;
      totalCompletedHours += completedHours;
      totalPendingHours += pendingHours;
      
      projectsMap[projectId].tasks.push({
        task_id: assignment.assignment_id,
        task_name: assignment.task_name,
        role: assignment.role,
        status: taskStatus,
        units_assigned: assignment.units_assigned,
        units_completed: Math.round(assignment.units_completed * 10) / 10,
        units_pending: Math.round(assignment.units_pending * 10) / 10,
        estimated_hours: Math.round(assignedHours * 10) / 10,
        completed_hours: Math.round(completedHours * 10) / 10,
        pending_hours: Math.round(pendingHours * 10) / 10,
        completion_percentage: assignment.units_assigned > 0 
          ? Math.round((assignment.units_completed / assignment.units_assigned) * 100) 
          : 0
      });
    });

    // Convert to array
    const tasks = Object.values(projectsMap);

    res.status(200).json({
      success: true,
      data: {
        employee: employee[0],
        summary: {
          total_tasks: assignments.length,
          total_not_started: totalNotStarted,
          total_in_progress: totalInProgress,
          total_assigned_hours: Math.round(totalAssignedHours * 10) / 10,
          total_completed_hours: Math.round(totalCompletedHours * 10) / 10,
          total_pending_hours: Math.round(totalPendingHours * 10) / 10,
          overall_completion_percentage: totalAssignedHours > 0 
            ? Math.round((totalCompletedHours / totalAssignedHours) * 100) 
            : 0
        },
        tasks: tasks
      }
    });

  } catch (err) {
    console.error('❌ getEmployeeAssignments error:', err);
    res.status(500).json({
      success: false,
      error: "Failed to fetch employee assignments",
      details: err.message
    });
  }
}
// POST /api/assignments
const addAssignment = async (req, res, next) => {
  try {
    const { 
      project_id, 
      user_id,
      emp_id,
      role, 
      task_name, 
      units_assigned,
      estimated_hours,
      estimated_days
    } = req.body;
    
    // ─── Validation ──────────────────────────────────────────────
    if (!project_id || !role || !task_name) {
      return res.status(400).json({ 
        message: "project_id, role, task_name required" 
      });
    }

    if (!user_id && !emp_id) {
      return res.status(400).json({
        message: "Either user_id or emp_id is required"
      });
    }

    // ─── Get employee details ──────────────────────────────────
    let finalEmpId = emp_id;
    let finalUserId = null;

    if (user_id && !emp_id) {
      // user_id can be emp_id or local users.id
      const empResult = await masterQuery(
        `SELECT u_id, emp_id, emp_name, emp_email FROM emp WHERE emp_id = ? AND flag = 'Active'`,
        [user_id]
      );
      
      if (empResult.length > 0) {
        finalEmpId = empResult[0].emp_id;
        finalUserId = await resolveLocalUserId(finalEmpId, empResult[0].emp_name, empResult[0].emp_email);
      } else {
        // Try local users table (maybe user_id is a local users.id)
        const userResult = await query(
          `SELECT emp_id, name, email FROM users WHERE id = ?`,
          [user_id]
        );
        if (userResult.length > 0) {
          finalEmpId = userResult[0].emp_id;
          finalUserId = user_id;
          
          // If local user has no emp_id, let's try to resolve it from master.emp by name/email
          if (!finalEmpId) {
            const empInfo = await masterQuery(
              `SELECT emp_id FROM emp WHERE emp_name = ? OR emp_email = ? AND flag = 'Active'`,
              [userResult[0].name, userResult[0].email]
            );
            if (empInfo.length > 0) {
              finalEmpId = empInfo[0].emp_id;
              // Self-heal: update users table
              await query("UPDATE users SET emp_id = ? WHERE id = ?", [finalEmpId, finalUserId]);
            }
          }
        } else {
          return res.status(400).json({
            message: "User not found in system"
          });
        }
      }
    } else if (emp_id && !user_id) {
      const empResult = await masterQuery(
        `SELECT u_id, emp_id, emp_name, emp_email FROM emp WHERE emp_id = ? AND flag = 'Active'`,
        [emp_id]
      );
      if (empResult.length > 0) {
        finalEmpId = empResult[0].emp_id;
        finalUserId = await resolveLocalUserId(finalEmpId, empResult[0].emp_name, empResult[0].emp_email);
      } else {
        return res.status(400).json({
          message: "Employee not found in master.emp"
        });
      }
    }

    if (!finalUserId) {
      return res.status(400).json({
        message: "User account not found in main database. Please contact an admin."
      });
    }

    // ─── ✅ REMOVED duplicate check ────────────────────────────
    // Allow multiple assignments for same employee with different roles/tasks

    // ─── VALIDATION: Check if assignment exceeds task limits ────
    const taskLoad = await query(
      `SELECT 
         planned_units, 
         estimated_days, 
         estimated_hours 
       FROM project_task_loads 
       WHERE project_id = ? AND role = ? AND task_name = ?`,
      [project_id, role, task_name]
    );

    if (taskLoad.length === 0) {
      return res.status(400).json({
        message: `No task load found for ${role} - ${task_name}. Please define task load first.`
      });
    }

    const plannedUnits = Number(taskLoad[0].planned_units) || 0;
    const plannedDays = Number(taskLoad[0].estimated_days) || 0;
    const plannedHours = Number(taskLoad[0].estimated_hours) || 0;

    // Get currently assigned totals for this task (across all employees)
    const assignedTotals = await query(
      `SELECT 
         SUM(units_assigned) as total_units,
         SUM(estimated_days) as total_days,
         SUM(estimated_hours) as total_hours
       FROM assignments 
       WHERE project_id = ? AND role = ? AND task_name = ?`,
      [project_id, role, task_name]
    );

    const currentUnits = Number(assignedTotals[0]?.total_units || 0);
    const currentDays = Number(assignedTotals[0]?.total_days || 0);
    const currentHours = Number(assignedTotals[0]?.total_hours || 0);

    const newUnits = parseInt(units_assigned, 10) || 0;
    const newDays = Number(estimated_days || 0);
    const newHours = Number(estimated_hours || 0);

    // Check if any limit would be exceeded
    const errors = [];
    let wouldExceed = false;

    if ((currentUnits + newUnits) > plannedUnits) {
      errors.push({
        field: 'units',
        message: `Cannot assign ${newUnits} units. Total would exceed planned units (${plannedUnits}). Remaining: ${plannedUnits - currentUnits}`,
        planned: plannedUnits,
        assigned: currentUnits,
        requested: newUnits,
        remaining: plannedUnits - currentUnits
      });
      wouldExceed = true;
    }

    if ((currentDays + newDays) > plannedDays) {
      errors.push({
        field: 'days',
        message: `Cannot assign ${newDays} days. Total would exceed planned days (${plannedDays}). Remaining: ${plannedDays - currentDays}`,
        planned: plannedDays,
        assigned: currentDays,
        requested: newDays,
        remaining: plannedDays - currentDays
      });
      wouldExceed = true;
    }

    if ((currentHours + newHours) > plannedHours) {
      errors.push({
        field: 'hours',
        message: `Cannot assign ${newHours} hours. Total would exceed planned hours (${plannedHours}). Remaining: ${plannedHours - currentHours}`,
        planned: plannedHours,
        assigned: currentHours,
        requested: newHours,
        remaining: plannedHours - currentHours
      });
      wouldExceed = true;
    }

    if (wouldExceed) {
      return res.status(400).json({
        success: false,
        message: 'Assignment would exceed task limits',
        errors: errors
      });
    }

    // ─── Get employee name for notification ──────────────────────
    const empInfo = await masterQuery(
      `SELECT emp_name FROM emp WHERE emp_id = ?`,
      [finalEmpId]
    );
    const employeeName = empInfo.length > 0 ? empInfo[0].emp_name : 'Employee';

    // ─── Insert assignment ──────────────────────────────────────
    const result = await query(
      `INSERT INTO assignments 
       (project_id, user_id, emp_id, role, task_name, units_assigned, estimated_days, estimated_hours) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [project_id, finalUserId, finalEmpId, role, task_name, newUnits, newDays, newHours]
    );

    // ─── Fetch the created assignment ──────────────────────────
    const rows = await query(
      `SELECT
          a.*,
          e.emp_name AS user_name,
          p.project_name,
          ee.effort_days,
          ee.effort_hrs,
          ee.buffer_days,
          ee.buffer_hrs,
          ee.total_hrs,
          ee.units,
          ee.unit_label
       FROM assignments a
       LEFT JOIN master.emp e ON a.emp_id = e.emp_id
       LEFT JOIN projects p ON a.project_id = p.id
       LEFT JOIN effort_estimates ee ON ee.project_id = a.project_id AND ee.role = a.role
       WHERE a.id = ?`,
      [result.insertId]
    );

    const assignment = rows[0];

    // ─── Create Notification ────────────────────────────────────
    try {
      await createNotification({
        user_id: finalUserId,
        type: 'assignment_created',
        title: `New assignment on ${assignment.project_name}`,
        message: `You (${employeeName}) have been assigned ${newUnits} unit(s) of "${task_name}" (${role}) on "${assignment.project_name}". (${newDays} days, ${newHours} hours)`,
      });
    } catch (notifErr) {
      console.warn('⚠️ Notification creation failed:', notifErr.message);
      // Don't fail the assignment if notification fails
    }

    // ─── Return response ────────────────────────────────────────
    return res.status(201).json({
      success: true,
      message: 'Assignment created successfully',
      data: assignment,
      remaining: {
        units: plannedUnits - (currentUnits + newUnits),
        days: plannedDays - (currentDays + newDays),
        hours: plannedHours - (currentHours + newHours)
      }
    });

  } catch (err) { 
    console.error('❌ addAssignment error:', err);
    return next(err); 
  }
};

// PUT /api/assignments/:id (UPDATED: Uses emp_id)
const updateAssignment = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { 
      units_assigned, 
      estimated_days, 
      estimated_hours 
    } = req.body;

    // ─── Validation: Check if assignment exists ──────────────────
    const assignmentExists = await query(
      `SELECT a.*, p.status as project_status 
       FROM assignments a
       LEFT JOIN projects p ON a.project_id = p.id
       WHERE a.id = ?`,
      [id]
    );
    
    if (!assignmentExists.length) {
      return res.status(404).json({
        success: false,
        message: 'Assignment not found'
      });
    }

    const currentAssignment = assignmentExists[0];

    // ─── Check if at least one field is provided for update ──────
    if (units_assigned === undefined && estimated_days === undefined && estimated_hours === undefined) {
      return res.status(400).json({
        success: false,
        message: 'At least one of units_assigned, estimated_days, or estimated_hours must be provided'
      });
    }

    // ─── Check assignment progress for any work started ──────────
    const progressCheck = await query(
      `SELECT 
         COUNT(*) as total_entries,
         SUM(units_completed) as total_units_completed,
         MAX(CASE WHEN status = 'APPROVED' THEN 1 ELSE 0 END) as has_approved,
         MAX(CASE WHEN status = 'REJECTED' THEN 1 ELSE 0 END) as has_rejected,
         MAX(status) as latest_status,
         GROUP_CONCAT(DISTINCT status) as all_statuses
       FROM assignment_progress 
       WHERE assignment_id = ?`,
      [id]
    );

    const progress = progressCheck[0] || {};
    const totalEntries = Number(progress.total_entries || 0);
    const totalUnitsCompleted = Number(progress.total_units_completed || 0);
    const hasApproved = Number(progress.has_approved || 0) > 0;
    const hasRejected = Number(progress.has_rejected || 0) > 0;
    const latestStatus = progress.latest_status;

    // ─── Determine if work has started ──────────────────────────
    let workStarted = false;
    let restrictionReason = '';

    // Check 1: Any units completed
    if (totalUnitsCompleted > 0) {
      workStarted = true;
      restrictionReason = `Work has started with ${totalUnitsCompleted} units already completed`;
    }
    // Check 2: Any approved entries (work has been accepted)
    else if (hasApproved) {
      workStarted = true;
      restrictionReason = 'Work has been approved';
    }
    // Check 3: Any rejected entries (work was attempted)
    else if (hasRejected) {
      workStarted = true;
      restrictionReason = 'Work has been submitted and rejected';
    }
    // Check 4: Any progress entries exist (even with 0 units)
    else if (totalEntries > 0) {
      // Check if any entry has actual task data (not just empty progress)
      const hasTaskData = await query(
        `SELECT COUNT(*) as count 
         FROM assignment_progress 
         WHERE assignment_id = ? 
         AND (todays_tasks IS NOT NULL OR yesterdays_tasks IS NOT NULL)`,
        [id]
      );
      
      if (Number(hasTaskData[0]?.count || 0) > 0) {
        workStarted = true;
        restrictionReason = 'Task progress has been recorded';
      }
    }

    if (workStarted) {
      return res.status(403).json({
        success: false,
        message: 'Cannot update assignment. Work has already started on this task',
        details: {
          reason: restrictionReason,
          total_units_completed: totalUnitsCompleted,
          total_progress_entries: totalEntries,
          latest_status: latestStatus || 'N/A',
          has_approved: hasApproved,
          has_rejected: hasRejected,
          assignment_id: id,
          task_name: currentAssignment.task_name,
          role: currentAssignment.role
        }
      });
    }

    // ─── Check project status: block only completed/abandoned projects ────
    const projectStatus = currentAssignment.project_status || 'Not started';
    const blockedStatuses = ['Completed', 'Abandoned'];

    if (blockedStatuses.includes(projectStatus)) {
      return res.status(403).json({
        success: false,
        message: `Cannot update assignment. Project is ${projectStatus}.`,
        details: {
          project_status: projectStatus,
          project_id: currentAssignment.project_id
        }
      });
    }

    // ─── Validate against task limits ────────────────────────────
    // Get the task load limits
    const taskLoad = await query(
      `SELECT 
         planned_units, 
         estimated_days, 
         estimated_hours 
       FROM project_task_loads 
       WHERE project_id = ? AND role = ? AND task_name = ?`,
      [currentAssignment.project_id, currentAssignment.role, currentAssignment.task_name]
    );

    if (taskLoad.length === 0) {
      return res.status(400).json({
        success: false,
        message: `No task load found for ${currentAssignment.role} - ${currentAssignment.task_name}. Please define task load first.`
      });
    }

    const plannedUnits = Number(taskLoad[0].planned_units) || 0;
    const plannedDays = Number(taskLoad[0].estimated_days) || 0;
    const plannedHours = Number(taskLoad[0].estimated_hours) || 0;

    // Get currently assigned totals for this task (excluding this assignment)
    const assignedTotals = await query(
      `SELECT 
         SUM(units_assigned) as total_units,
         SUM(estimated_days) as total_days,
         SUM(estimated_hours) as total_hours
       FROM assignments 
       WHERE project_id = ? AND role = ? AND task_name = ? AND id != ?`,
      [currentAssignment.project_id, currentAssignment.role, currentAssignment.task_name, id]
    );

    const currentUnits = Number(assignedTotals[0]?.total_units || 0);
    const currentDays = Number(assignedTotals[0]?.total_days || 0);
    const currentHours = Number(assignedTotals[0]?.total_hours || 0);

    // Determine new values (use existing if not provided)
    const newUnits = units_assigned !== undefined ? (parseInt(units_assigned, 10) || 0) : Number(currentAssignment.units_assigned);
    const newDays = estimated_days !== undefined ? Number(estimated_days) : Number(currentAssignment.estimated_days);
    const newHours = estimated_hours !== undefined ? Number(estimated_hours) : Number(currentAssignment.estimated_hours);

    // Check if any limit would be exceeded
    const errors = [];
    let wouldExceed = false;

    // When checking units, subtract any units already completed
    const completedUnits = Number(progress.total_units_completed || 0);
    const effectiveCurrentUnits = currentUnits - completedUnits;

    if ((effectiveCurrentUnits + newUnits) > plannedUnits) {
      errors.push({
        field: 'units',
        message: `Cannot assign ${newUnits} units. Total would exceed planned units (${plannedUnits}). Already completed: ${completedUnits}, Remaining: ${plannedUnits - effectiveCurrentUnits}`,
        planned: plannedUnits,
        assigned: currentUnits,
        completed: completedUnits,
        requested: newUnits,
        remaining: plannedUnits - effectiveCurrentUnits
      });
      wouldExceed = true;
    }

    if ((currentDays + newDays) > plannedDays) {
      errors.push({
        field: 'days',
        message: `Cannot assign ${newDays} days. Total would exceed planned days (${plannedDays}). Remaining: ${plannedDays - currentDays}`,
        planned: plannedDays,
        assigned: currentDays,
        requested: newDays,
        remaining: plannedDays - currentDays
      });
      wouldExceed = true;
    }

    if ((currentHours + newHours) > plannedHours) {
      errors.push({
        field: 'hours',
        message: `Cannot assign ${newHours} hours. Total would exceed planned hours (${plannedHours}). Remaining: ${plannedHours - currentHours}`,
        planned: plannedHours,
        assigned: currentHours,
        requested: newHours,
        remaining: plannedHours - currentHours
      });
      wouldExceed = true;
    }

    if (wouldExceed) {
      return res.status(400).json({
        success: false,
        message: 'Update would exceed task limits',
        errors: errors
      });
    }

    // ─── Build update query (ONLY these 3 fields) ───────────────
    let updateFields = [];
    let updateValues = [];

    if (units_assigned !== undefined) {
      updateFields.push('units_assigned = ?');
      updateValues.push(newUnits);
    }

    if (estimated_days !== undefined) {
      updateFields.push('estimated_days = ?');
      updateValues.push(newDays);
    }

    if (estimated_hours !== undefined) {
      updateFields.push('estimated_hours = ?');
      updateValues.push(newHours);
    }

    updateValues.push(id);

    // ─── Execute update ──────────────────────────────────────────
    await query(
      `UPDATE assignments SET ${updateFields.join(', ')} WHERE id = ?`,
      updateValues
    );

    // ─── Fetch updated assignment ────────────────────────────────
    const updatedRows = await query(
      `SELECT
          a.*,
          e.emp_name AS user_name,
          p.project_name,
          p.status as project_status,
          ee.effort_days,
          ee.effort_hrs,
          ee.buffer_days,
          ee.buffer_hrs,
          ee.total_hrs,
          ee.units,
          ee.unit_label
       FROM assignments a
       LEFT JOIN master.emp e ON a.emp_id = e.emp_id
       LEFT JOIN projects p ON a.project_id = p.id
       LEFT JOIN effort_estimates ee ON ee.project_id = a.project_id AND ee.role = a.role
       WHERE a.id = ?`,
      [id]
    );

    // ─── Calculate remaining capacities ──────────────────────────
    const updatedTotals = await query(
      `SELECT 
         SUM(units_assigned) as total_units,
         SUM(estimated_days) as total_days,
         SUM(estimated_hours) as total_hours
       FROM assignments 
       WHERE project_id = ? AND role = ? AND task_name = ?`,
      [currentAssignment.project_id, currentAssignment.role, currentAssignment.task_name]
    );

    const totalUnits = Number(updatedTotals[0]?.total_units || 0);
    const totalDays = Number(updatedTotals[0]?.total_days || 0);
    const totalHours = Number(updatedTotals[0]?.total_hours || 0);

    // ─── Return response ──────────────────────────────────────────
    return res.status(200).json({
      success: true,
      message: 'Assignment updated successfully',
      data: updatedRows[0],
      remaining: {
        units: plannedUnits - (totalUnits - completedUnits),
        days: plannedDays - totalDays,
        hours: plannedHours - totalHours
      },
      note: 'Only units_assigned, estimated_days, and estimated_hours can be updated'
    });

  } catch (err) {
    console.error('❌ updateAssignment error:', err);
    return next(err);
  }
};

// DELETE /api/assignments/:id
const deleteAssignment = async (req, res, next) => {
  try {
    await query(`DELETE FROM assignments WHERE id=?`, [req.params.id]);
    res.json({ message: "Deleted" });
  } catch (err) { next(err); }
};

module.exports = {
  getCatalog,
  getEffortEstimates,
  getTaskLoads,
  upsertTaskLoad,
  bulkUpsertTaskLoads,
  getProjectSummary,
  getAssignmentsByProject,
  addAssignment,
  updateAssignment,
  deleteAssignment,
  getEmployeeAssignments
};