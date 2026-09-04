const { query, masterQuery } = require("../config/db");
const { createNotification } = require("./notification.controller");
const XLSX = require("xlsx");

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

// ─────────────────────────────────────────────────────────────────────────────
// EMP: Get my assignments with completed + pending
// Only APPROVED progress rows count toward completed
// ─────────────────────────────────────────────────────────────────────────────
// EMP: Get my assignments with completed + pending
// GET /api/utilization/my-assignments?userId=
// ─────────────────────────────────────────────────────────────────────────────
const getMyAssignments = async (req, res, next) => {
  try {
    let { userId } = req.query;
    let empId = null;

    // ✅ If userId not provided, get from token using emp_id
    if (!userId || userId === "null" || userId === "undefined") {
      empId = req.user?.emp_id;
      if (empId) {
        console.log(`ℹ️ Using emp_id from token: ${empId}`);
      }
    } else {
      // Check if userId is an emp_id (string like "AS00717")
      if (typeof userId === 'string' && !/^\d+$/.test(userId)) {
        empId = userId;
        console.log(`ℹ️ Using userId as emp_id: ${empId}`);
      } else {
        // userId might be u_id from master.emp, get emp_id from it
        const empResult = await masterQuery(
          `SELECT emp_id FROM emp WHERE u_id = ? AND flag = 'Active'`,
          [userId]
        );
        if (empResult && empResult.length > 0) {
          empId = empResult[0].emp_id;
          console.log(`ℹ️ Resolved emp_id from u_id ${userId}: ${empId}`);
        } else {
          // Try as users.id (backward compatibility)
          const userResult = await query(
            `SELECT emp_id FROM users WHERE id = ?`,
            [userId]
          );
          if (userResult && userResult.length > 0) {
            empId = userResult[0].emp_id;
            console.log(`ℹ️ Resolved emp_id from users.id ${userId}: ${empId}`);
          }
        }
      }
    }

    // If still no emp_id, try from token
    if (!empId) {
      empId = req.user?.emp_id;
    }

    if (!empId) {
      return res.status(400).json({ 
        message: "Employee not found. Please login again." 
      });
    }

    // ✅ Query with estimated_hours and total_time_needed (utilized hours)
    const sql = `
      SELECT
        a.id                                                          AS assignment_id,
        a.project_id,
        p.project_name,
        a.role,
        a.task_name,
        a.units_assigned,
        a.estimated_hours                                             AS estimated_hours,
        COALESCE(SUM(CASE WHEN ap.status = 'APPROVED' THEN ap.units_completed ELSE 0 END), 0)
                                                                      AS units_completed,
        GREATEST(
          a.units_assigned
          - COALESCE(SUM(CASE WHEN ap.status = 'APPROVED' THEN ap.units_completed ELSE 0 END), 0),
          0
        )                                                             AS units_pending,
        COALESCE(SUM(CASE WHEN ap.status = 'PENDING' THEN ap.units_completed ELSE 0 END), 0)
                                                                      AS units_awaiting,
        COALESCE(SUM(CASE WHEN ap.status = 'APPROVED' THEN CAST(ap.total_time_needed AS DECIMAL(10,2)) ELSE 0 END), 0)
                                                                      AS utilized_hours,
        GREATEST(
          a.estimated_hours
          - COALESCE(SUM(CASE WHEN ap.status = 'APPROVED' THEN CAST(ap.total_time_needed AS DECIMAL(10,2)) ELSE 0 END), 0),
          0
        )                                                             AS hours_pending,
        CASE
          WHEN a.estimated_hours > 0 THEN
            ROUND(
              (COALESCE(SUM(CASE WHEN ap.status = 'APPROVED' THEN CAST(ap.total_time_needed AS DECIMAL(10,2)) ELSE 0 END), 0) / a.estimated_hours) * 100,
              1
            )
          ELSE 0
        END                                                           AS hours_utilization_pct
      FROM assignments a
      LEFT JOIN projects p              ON a.project_id = p.id
      LEFT JOIN assignment_progress ap  ON a.id         = ap.assignment_id
      WHERE a.emp_id = ?                -- ✅ Filter by emp_id instead of user_id
      GROUP BY a.id, a.project_id, p.project_name, a.role, a.task_name, a.units_assigned, a.estimated_hours
      ORDER BY p.project_name, a.role
    `;

    const rows = await query(sql, [empId]);
    console.log(`✅ Found ${rows.length} assignments for emp_id: ${empId}`);
    return res.status(200).json(rows);
  } catch (err) {
    console.error('❌ getMyAssignments error:', err);
    return next(err);
  }
};


// ─────────────────────────────────────────────────────────────────────────────
// EMP: Log progress on an assignment
// Inserts with status = 'PENDING', notifies all admins
// POST /api/utilization/log-progress
// Body: { assignment_id, user_id, date, units_completed, remarks }
// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
// EMP: Log progress on an assignment
// POST /api/utilization/log-progress
// ─────────────────────────────────────────────────────────────────────────────
const logProgress = async (req, res, next) => {
  try {
    let { 
      assignment_id, user_id, date, units_completed, 
      todays_tasks, total_time_needed, yesterdays_tasks, risks,
      project_id, role, task_name, remarks, availability
    } = req.body;

    let finalEmpId = null;
    let finalUserId = null;

    // ✅ Get emp_id from request or token
    if (user_id && user_id !== "null" && user_id !== "undefined") {
      if (typeof user_id === 'string' && !/^\d+$/.test(user_id)) {
        finalEmpId = user_id;
        const empResult = await masterQuery(
          `SELECT u_id, emp_id, emp_name, emp_email FROM emp WHERE emp_id = ? AND flag = 'Active'`,
          [finalEmpId]
        );
        if (empResult.length > 0) {
          finalUserId = await resolveLocalUserId(finalEmpId, empResult[0].emp_name, empResult[0].emp_email);
        }
      } else {
        const empResult = await masterQuery(
          `SELECT u_id, emp_id, emp_name, emp_email FROM emp WHERE u_id = ? AND flag = 'Active'`,
          [user_id]
        );
        if (empResult.length > 0) {
          finalEmpId = empResult[0].emp_id;
          finalUserId = await resolveLocalUserId(finalEmpId, empResult[0].emp_name, empResult[0].emp_email);
        } else {
          const userResult = await query(
            `SELECT emp_id, name, email FROM users WHERE id = ?`,
            [user_id]
          );
          if (userResult.length > 0) {
            finalEmpId = userResult[0].emp_id;
            finalUserId = user_id;
            
            if (finalEmpId) {
              const empInfo = await masterQuery(
                `SELECT emp_name, emp_email FROM emp WHERE emp_id = ? AND flag = 'Active'`,
                [finalEmpId]
              );
              if (empInfo.length > 0) {
                // Self-heal
                await query("UPDATE users SET emp_id = ? WHERE id = ?", [finalEmpId, finalUserId]);
              }
            }
          }
        }
      }
    }

    if (!finalEmpId) {
      const empId = req.user?.emp_id;
      if (empId) {
        const empResult = await masterQuery(
          `SELECT u_id, emp_id, emp_name, emp_email FROM emp WHERE emp_id = ? AND flag = 'Active'`,
          [empId]
        );
        if (empResult && empResult.length > 0) {
          finalEmpId = empResult[0].emp_id;
          finalUserId = await resolveLocalUserId(finalEmpId, empResult[0].emp_name, empResult[0].emp_email);
        }
      }
    }

    if (!finalEmpId) {
      return res.status(400).json({ 
        message: "Employee not found. Please ensure you're logged in." 
      });
    }

    if (!finalUserId) {
      return res.status(400).json({
        message: "User account not found in main database. Please contact an admin."
      });
    }

    if (!date) {
      return res.status(400).json({ message: "date is required" });
    }

    if (!todays_tasks || !todays_tasks.trim()) {
      return res.status(400).json({ message: "Today's Tasks are required" });
    }

    if (!total_time_needed || !total_time_needed.trim()) {
      return res.status(400).json({ message: "Total Time Needed is required" });
    }

    if (assignment_id) {
      // ✅ Verify the assignment belongs to this employee
      const assignmentCheck = await query(
        `SELECT emp_id, units_assigned FROM assignments WHERE id = ?`,
        [assignment_id]
      );

      if (assignmentCheck.length === 0) {
        return res.status(404).json({ message: "Assignment not found" });
      }

      if (assignmentCheck[0].emp_id !== finalEmpId) {
        return res.status(403).json({ 
          message: "You are not authorized to log progress for this assignment" 
        });
      }

      const totalAssigned = assignmentCheck[0].units_assigned;

      // ✅ Get total completed so far (including this new entry)
      const completedSoFar = await query(
        `SELECT COALESCE(SUM(units_completed), 0) AS total_completed
         FROM assignment_progress
         WHERE assignment_id = ?`,
        [assignment_id]
      );

      const currentCompleted = parseFloat(completedSoFar[0]?.total_completed || 0);
      const newUnits = parseInt(units_completed, 10) || 0;

      // ✅ Check if logging would exceed assigned units
      if (newUnits > 0 && (currentCompleted + newUnits) > totalAssigned) {
        return res.status(400).json({
          message: `Cannot log ${newUnits} units. Only ${totalAssigned - currentCompleted} units remaining.`
        });
      }
    } else {
      // For manual task, project_id, role and task_name are required
      if (!project_id) {
        return res.status(400).json({ message: "Project is required for manual tasks" });
      }
      if (!role) {
        return res.status(400).json({ message: "Role is required for manual tasks" });
      }
      if (!task_name || !task_name.trim()) {
        return res.status(400).json({ message: "Task Name/Title is required for manual tasks" });
      }
    }

    // ✅ Insert with AUTO-APPROVED status
    const result = await query(
      `INSERT INTO assignment_progress (
         assignment_id, user_id, emp_id, date, units_completed, 
         todays_tasks, total_time_needed, yesterdays_tasks, risks, 
         project_id, role, task_name, remarks, status, availability
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'APPROVED', ?)`,
      [
        assignment_id || null, finalUserId, finalEmpId, date, parseInt(units_completed, 10) || 0, 
        todays_tasks || null, total_time_needed || null, yesterdays_tasks || null, risks || null,
        project_id || null, role || null, task_name || null, remarks || null, availability || null
      ]
    );

    // ✅ Fetch context for notification
    if (assignment_id) {
      const ctxRows = await query(
        `SELECT a.role, a.task_name, p.project_name, e.emp_name AS emp_name
         FROM assignments a
         LEFT JOIN projects p ON a.project_id = p.id
         LEFT JOIN master.emp e ON a.emp_id = e.emp_id
         WHERE a.id = ?`,
        [assignment_id]
      );
      if (ctxRows.length > 0) {
        const ctx = ctxRows[0];
        try {
          await createNotification({
            user_id: finalUserId,
            type: 'progress_approved',
            title: `Progress logged successfully ✓`,
            message: `You have logged ${units_completed || 0} unit(s) of "${ctx.task_name}" (${ctx.role}) on "${ctx.project_name}".`,
          });
        } catch (nErr) {
          console.warn('⚠️ Notification failed:', nErr.message);
        }
      }
    } else {
      const projRow = await query("SELECT project_name FROM projects WHERE id = ?", [project_id]);
      const projectName = projRow.length > 0 ? projRow[0].project_name : "Unknown Project";
      try {
        await createNotification({
          user_id: finalUserId,
          type: 'progress_approved',
          title: `Manual task added successfully ✓`,
          message: `You have added a manual task "${task_name}" for "${projectName}".`,
        });
      } catch (nErr) {
        console.warn('⚠️ Notification failed:', nErr.message);
      }
    }

    return res.status(201).json({
      id: result.insertId,
      status: 'APPROVED',
      message: "Progress logged successfully!"
    });
  } catch (err) {
    console.error('❌ logProgress error:', err);
    return next(err);
  }
};
// ─────────────────────────────────────────────────────────────────────────────
// ADMIN: Get all pending approval items
// GET /api/utilization/pending-approvals
// ─────────────────────────────────────────────────────────────────────────────
const getPendingApprovals = async (req, res, next) => {
  try {
    // ✅ Join with master.emp for employee name
    const rows = await query(
      `SELECT
         ap.id                 AS progress_id,
         ap.assignment_id,
         ap.date,
         ap.units_completed,
         ap.remarks,
         ap.status,
         ap.rejection_reason,
         e.u_id                AS user_id,
         e.emp_name            AS user_name,
         a.role,
         a.task_name,
         a.units_assigned,
         p.id                  AS project_id,
         p.project_name
       FROM assignment_progress ap
       LEFT JOIN assignments a ON ap.assignment_id = a.id
       LEFT JOIN master.emp e ON ap.emp_id = e.emp_id
       LEFT JOIN projects p    ON a.project_id     = p.id
       WHERE ap.status = 'PENDING'
       ORDER BY ap.date ASC`
    );
    return res.status(200).json(rows);
  } catch (err) {
    return next(err);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN: Approve a progress log
// PUT /api/utilization/approve/:progressId
// ─────────────────────────────────────────────────────────────────────────────
const approveProgress = async (req, res, next) => {
  try {
    const { progressId } = req.params;

    // ✅ Fetch context with employee name from master.emp
    const rows = await query(
      `SELECT ap.*, e.emp_name AS emp_name, a.task_name, a.role, p.project_name
       FROM assignment_progress ap
       LEFT JOIN assignments a ON ap.assignment_id = a.id
       LEFT JOIN master.emp e ON ap.emp_id = e.emp_id
       LEFT JOIN projects p    ON a.project_id     = p.id
       WHERE ap.id = ?`,
      [progressId]
    );

    if (rows.length === 0) return res.status(404).json({ message: "Progress log not found" });
    const ap = rows[0];

    if (ap.status !== 'PENDING') {
      return res.status(400).json({ message: `Cannot approve — current status is ${ap.status}` });
    }

    await query(
      `UPDATE assignment_progress SET status = 'APPROVED', rejection_reason = NULL WHERE id = ?`,
      [progressId]
    );

    // Notify the employee
    await createNotification({
      user_id: ap.user_id,
      type:    'progress_approved',
      title:   `Progress approved ✓`,
      message: `Your log of ${ap.units_completed} unit(s) for "${ap.task_name}" (${ap.role}) on "${ap.project_name}" has been approved.`,
    });

    return res.status(200).json({ message: "Approved" });
  } catch (err) {
    return next(err);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN: Reject a progress log
// PUT /api/utilization/reject/:progressId
// ─────────────────────────────────────────────────────────────────────────────
const rejectProgress = async (req, res, next) => {
  try {
    const { progressId } = req.params;
    const { reason }     = req.body;

    // ✅ Fetch context with employee name from master.emp
    const rows = await query(
      `SELECT ap.*, e.emp_name AS emp_name, a.task_name, a.role, p.project_name
       FROM assignment_progress ap
       LEFT JOIN assignments a ON ap.assignment_id = a.id
       LEFT JOIN master.emp e ON ap.emp_id = e.emp_id
       LEFT JOIN projects p    ON a.project_id     = p.id
       WHERE ap.id = ?`,
      [progressId]
    );

    if (rows.length === 0) return res.status(404).json({ message: "Progress log not found" });
    const ap = rows[0];

    if (ap.status !== 'PENDING') {
      return res.status(400).json({ message: `Cannot reject — current status is ${ap.status}` });
    }

    await query(
      `UPDATE assignment_progress SET status = 'REJECTED', rejection_reason = ? WHERE id = ?`,
      [reason || null, progressId]
    );

    // Notify the employee
    await createNotification({
      user_id: ap.user_id,
      type:    'progress_rejected',
      title:   `Progress update rejected`,
      message: `Your log of ${ap.units_completed} unit(s) for "${ap.task_name}" on "${ap.project_name}" was rejected.${reason ? ` Reason: ${reason}` : ""}`,
    });

    return res.status(200).json({ message: "Rejected" });
  } catch (err) {
    return next(err);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN: Overall user utilization (APPROVED only) - Using master.emp only
// GET /api/utilization/overall
// ─────────────────────────────────────────────────────────────────────────────
const getOverallUtilization = async (req, res, next) => {
  try {
    // ─── Get all active employees from master.emp ────────────────
    const employees = await masterQuery(
      `SELECT u_id, emp_id, emp_name FROM emp WHERE flag = 'Active'`
    );

    if (employees.length === 0) {
      return res.status(200).json([]);
    }

    // ─── Get u_ids for the assignment query ──────────────────────
    const uIds = employees.map(e => e.u_id);
    const uIdPlaceholders = uIds.map(() => '?').join(',');

    // ─── Get assignment data for these employees ──────────────────
    const assignmentData = await query(`
      SELECT
        a.user_id,
        COALESCE(SUM(a.units_assigned), 0) AS total_assigned,
        COALESCE(SUM(ap_totals.units_completed), 0) AS total_completed
      FROM assignments a
      LEFT JOIN (
        SELECT assignment_id, SUM(units_completed) AS units_completed
        FROM assignment_progress
        WHERE status = 'APPROVED'
        GROUP BY assignment_id
      ) ap_totals ON a.id = ap_totals.assignment_id
      WHERE a.user_id IN (${uIdPlaceholders})
      GROUP BY a.user_id
    `, uIds);

    // ─── Create a map for quick lookup ────────────────────────────
    const assignmentMap = {};
    assignmentData.forEach(row => {
      assignmentMap[row.user_id] = {
        total_assigned: parseFloat(row.total_assigned) || 0,
        total_completed: parseFloat(row.total_completed) || 0
      };
    });

    // ─── Combine employee data with assignment data ──────────────
    const result = employees.map(emp => {
      const data = assignmentMap[emp.u_id] || { total_assigned: 0, total_completed: 0 };
      const totalAssigned = data.total_assigned;
      const totalCompleted = data.total_completed;
      const totalPending = totalAssigned - totalCompleted;
      const utilizationPct = totalAssigned > 0 
        ? Math.round((totalCompleted / totalAssigned) * 100 * 10) / 10
        : 0;

      return {
        user_id: emp.u_id,
        user_name: emp.emp_name,
        user_role: 'EMP', // Default role since it comes from RBAC
        daily_capacity: 8, // Default capacity
        total_assigned: totalAssigned,
        total_completed: totalCompleted,
        total_pending: totalPending,
        utilization_pct: utilizationPct
      };
    });

    // ─── Sort by utilization percentage descending ──────────────
    result.sort((a, b) => b.utilization_pct - a.utilization_pct);

    return res.status(200).json(result);
    
  } catch (err) {
    console.error('❌ getOverallUtilization error:', err);
    return next(err);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN: Project-wise utilization (APPROVED only) - Using master.emp only
// GET /api/utilization/by-project
// ─────────────────────────────────────────────────────────────────────────────
const getProjectUtilization = async (req, res, next) => {
  try {
    const { projectId } = req.query;

    // ─── Base query using master.emp ──────────────────────────────
    let sql = `
      SELECT
        p.id                                              AS project_id,
        p.project_name,
        e.u_id                                            AS user_id,
        e.emp_name                                        AS user_name,
        a.role,
        a.task_name,
        a.units_assigned,
        a.estimated_hours                                 AS hours_assigned,
        COALESCE(ap_totals.units_completed, 0)            AS units_completed,
        GREATEST(a.units_assigned - COALESCE(ap_totals.units_completed, 0), 0) AS units_pending,
        COALESCE(ap_totals.total_time_needed, 0)          AS hours_utilized,
        GREATEST(
          a.estimated_hours - COALESCE(ap_totals.total_time_needed, 0), 
          0
        )                                                 AS hours_pending,
        CASE
          WHEN a.units_assigned = 0 THEN 0
          ELSE ROUND(
            (COALESCE(ap_totals.units_completed, 0) / a.units_assigned) * 100, 1
          )
        END                                               AS completion_pct
      FROM assignments a
      LEFT JOIN projects p ON a.project_id = p.id
      LEFT JOIN master.emp e ON a.emp_id = e.emp_id
      LEFT JOIN (
        SELECT 
          assignment_id, 
          SUM(units_completed) AS units_completed,
          SUM(CAST(total_time_needed AS DECIMAL(10,2))) AS total_time_needed
        FROM assignment_progress
        WHERE status = 'APPROVED'
        GROUP BY assignment_id
      ) ap_totals ON a.id = ap_totals.assignment_id
      WHERE e.emp_id IS NOT NULL
    `;

    const params = [];
    if (projectId) {
      sql += ` AND a.project_id = ?`;
      params.push(projectId);
    }
    sql += ` ORDER BY p.project_name, e.emp_name, a.role`;

    const rows = await query(sql, params);
    return res.status(200).json(rows);
    
  } catch (err) {
    console.error('❌ getProjectUtilization error:', err);
    return next(err);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN: Project health cards (APPROVED only)
// GET /api/utilization/project-health
// ─────────────────────────────────────────────────────────────────────────────
const getProjectHealth = async (req, res, next) => {
  try {
    const sql = `
      SELECT
        p.id                                                    AS project_id,
        p.project_name,
        p.status,
        p.start_date,
        p.end_date,
        COALESCE(ptl_totals.total_load, 0)                      AS total_load,
        COALESCE(a_totals.total_assigned, 0)                    AS total_assigned,
        COALESCE(a_totals.total_completed, 0)                   AS total_completed,
        GREATEST(
          COALESCE(a_totals.total_assigned,  0)
          - COALESCE(a_totals.total_completed, 0), 0
        )                                                       AS total_pending,
        GREATEST(
          COALESCE(ptl_totals.total_load,    0)
          - COALESCE(a_totals.total_assigned, 0), 0
        )                                                       AS total_unassigned,
        CASE
          WHEN COALESCE(a_totals.total_assigned, 0) = 0 THEN 0
          ELSE ROUND(
            COALESCE(a_totals.total_completed, 0) /
            COALESCE(a_totals.total_assigned,  0) * 100, 1
          )
        END                                                     AS completion_pct
      FROM projects p
      LEFT JOIN (
        SELECT project_id, SUM(planned_units) AS total_load
        FROM project_task_loads
        GROUP BY project_id
      ) ptl_totals ON ptl_totals.project_id = p.id
      LEFT JOIN (
        SELECT
          a.project_id,
          SUM(a.units_assigned)                      AS total_assigned,
          COALESCE(SUM(ap_sub.units_completed), 0)   AS total_completed
        FROM assignments a
        LEFT JOIN (
          SELECT assignment_id, SUM(units_completed) AS units_completed
          FROM assignment_progress
          WHERE status = 'APPROVED'
          GROUP BY assignment_id
        ) ap_sub ON ap_sub.assignment_id = a.id
        GROUP BY a.project_id
      ) a_totals ON a_totals.project_id = p.id
      ORDER BY p.project_name
    `;

    const rows = await query(sql);
    return res.status(200).json(rows);
  } catch (err) {
    return next(err);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN: Project-level Unit Utilization Summary
// GET /api/utilization/project-unit-summary?projectId=
// ─────────────────────────────────────────────────────────────────────────────
const getProjectUnitSummary = async (req, res, next) => {
  try {
    const { projectId } = req.query;

    let sql = `
      SELECT
        p.id                                              AS project_id,
        p.project_name,
        p.project_code,
        p.status,
        COALESCE(SUM(a.units_assigned), 0)                AS total_units,
        COALESCE(SUM(ap_totals.units_completed), 0)       AS completed_units,
        GREATEST(
          COALESCE(SUM(a.units_assigned), 0)
          - COALESCE(SUM(ap_totals.units_completed), 0),
          0
        )                                                 AS pending_units,
        CASE
          WHEN COALESCE(SUM(a.units_assigned), 0) = 0 THEN 0
          ELSE ROUND(
            COALESCE(SUM(ap_totals.units_completed), 0) /
            COALESCE(SUM(a.units_assigned), 0) * 100, 1
          )
        END                                               AS utilization_pct
      FROM projects p
      LEFT JOIN assignments a ON a.project_id = p.id
      LEFT JOIN (
        SELECT assignment_id, SUM(units_completed) AS units_completed
        FROM assignment_progress
        WHERE status = 'APPROVED'
        GROUP BY assignment_id
      ) ap_totals ON ap_totals.assignment_id = a.id
    `;

    const params = [];
    if (projectId) {
      sql += ` WHERE p.id = ?`;
      params.push(projectId);
    }
    sql += ` GROUP BY p.id, p.project_name, p.project_code, p.status ORDER BY p.project_name`;

    const rows = await query(sql, params);
    return res.status(200).json(rows);
  } catch (err) {
    console.error('❌ getProjectUnitSummary error:', err);
    return next(err);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN: Employee-level Unit Utilization Summary
// GET /api/utilization/employee-unit-summary?projectId=&empId=
// Returns:
//   - per-project breakdown for the employee
//   - overall summary across all projects
// ─────────────────────────────────────────────────────────────────────────────
const getEmployeeUnitSummary = async (req, res, next) => {
  try {
    const { projectId, empId } = req.query;

    if (!empId) {
      return res.status(400).json({ message: 'empId is required' });
    }

    // ── 1. Per-project task breakdown for this employee ─────────────────────
    let taskSql = `
      SELECT
        p.id                                              AS project_id,
        p.project_name,
        a.id                                              AS assignment_id,
        a.task_name,
        a.role,
        a.units_assigned,
        COALESCE(ap_totals.units_completed, 0)            AS units_completed,
        GREATEST(
          a.units_assigned - COALESCE(ap_totals.units_completed, 0),
          0
        )                                                 AS units_pending
      FROM assignments a
      LEFT JOIN projects p ON a.project_id = p.id
      LEFT JOIN (
        SELECT assignment_id, SUM(units_completed) AS units_completed
        FROM assignment_progress
        WHERE status = 'APPROVED'
        GROUP BY assignment_id
      ) ap_totals ON ap_totals.assignment_id = a.id
      WHERE a.emp_id = ?
    `;
    const taskParams = [empId];
    if (projectId) {
      taskSql += ` AND a.project_id = ?`;
      taskParams.push(projectId);
    }
    taskSql += ` ORDER BY p.project_name, a.task_name`;

    const taskRows = await query(taskSql, taskParams);

    // ── 2. Project-level summary for this employee in the selected project ───
    let projectSumSql = `
      SELECT
        p.id                                              AS project_id,
        p.project_name,
        COUNT(DISTINCT a.id)                              AS total_tasks,
        COALESCE(SUM(a.units_assigned), 0)                AS total_units_assigned,
        COALESCE(SUM(ap_totals.units_completed), 0)       AS total_units_completed,
        GREATEST(
          COALESCE(SUM(a.units_assigned), 0)
          - COALESCE(SUM(ap_totals.units_completed), 0),
          0
        )                                                 AS total_units_pending,
        CASE
          WHEN COALESCE(SUM(a.units_assigned), 0) = 0 THEN 0
          ELSE ROUND(
            COALESCE(SUM(ap_totals.units_completed), 0) /
            COALESCE(SUM(a.units_assigned), 0) * 100, 1
          )
        END                                               AS employee_utilization_pct
      FROM assignments a
      LEFT JOIN projects p ON a.project_id = p.id
      LEFT JOIN (
        SELECT assignment_id, SUM(units_completed) AS units_completed
        FROM assignment_progress
        WHERE status = 'APPROVED'
        GROUP BY assignment_id
      ) ap_totals ON ap_totals.assignment_id = a.id
      WHERE a.emp_id = ?
    `;
    const projectSumParams = [empId];
    if (projectId) {
      projectSumSql += ` AND a.project_id = ?`;
      projectSumParams.push(projectId);
    }
    projectSumSql += ` GROUP BY p.id, p.project_name`;

    const projectSummary = await query(projectSumSql, projectSumParams);

    // ── 3. Overall summary for this employee across ALL projects ────────────
    const overallSql = `
      SELECT
        COUNT(DISTINCT a.project_id)                      AS total_projects,
        COUNT(DISTINCT a.id)                              AS total_tasks,
        COALESCE(SUM(a.units_assigned), 0)                AS total_units_assigned,
        COALESCE(SUM(ap_totals.units_completed), 0)       AS total_units_completed,
        GREATEST(
          COALESCE(SUM(a.units_assigned), 0)
          - COALESCE(SUM(ap_totals.units_completed), 0),
          0
        )                                                 AS total_units_pending,
        CASE
          WHEN COALESCE(SUM(a.units_assigned), 0) = 0 THEN 0
          ELSE ROUND(
            COALESCE(SUM(ap_totals.units_completed), 0) /
            COALESCE(SUM(a.units_assigned), 0) * 100, 1
          )
        END                                               AS overall_utilization_pct
      FROM assignments a
      LEFT JOIN (
        SELECT assignment_id, SUM(units_completed) AS units_completed
        FROM assignment_progress
        WHERE status = 'APPROVED'
        GROUP BY assignment_id
      ) ap_totals ON ap_totals.assignment_id = a.id
      WHERE a.emp_id = ?
    `;
    const overallRow = await query(overallSql, [empId]);

    // ── 4. Fetch employee name from master ──────────────────────────────────
    const empInfo = await masterQuery(
      `SELECT emp_name, emp_id FROM emp WHERE emp_id = ? LIMIT 1`,
      [empId]
    );

    return res.status(200).json({
      employee: empInfo[0] || { emp_name: empId, emp_id: empId },
      task_breakdown: taskRows,
      project_summary: projectSummary,
      overall_summary: overallRow[0] || {},
    });
  } catch (err) {
    console.error('❌ getEmployeeUnitSummary error:', err);
    return next(err);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// EXPORT: Employee Utilization — within Project to Excel
// GET /api/utilization/export/employee-project-unit?projectId=&empId=
// ─────────────────────────────────────────────────────────────────────────────
const exportEmployeeProjectUnit = async (req, res, next) => {
  try {
    const { projectId, empId } = req.query;
    if (!empId) {
      return res.status(400).json({ message: "empId is required for export" });
    }

    // Resolve employee name
    const empInfo = await masterQuery(
      `SELECT emp_name FROM emp WHERE emp_id = ? LIMIT 1`,
      [empId]
    );
    const empName = empInfo[0]?.emp_name || empId;

    let sql = `
      SELECT
        p.project_name,
        a.task_name,
        a.units_assigned,
        a.estimated_hours                                 AS hours_assigned,
        COALESCE(ap_totals.units_completed, 0)            AS units_completed,
        GREATEST(a.units_assigned - COALESCE(ap_totals.units_completed, 0), 0) AS units_pending,
        COALESCE(ap_totals.total_time_needed, 0)          AS hours_utilized
      FROM assignments a
      LEFT JOIN projects p ON a.project_id = p.id
      LEFT JOIN (
        SELECT 
          assignment_id, 
          SUM(units_completed) AS units_completed,
          SUM(CAST(total_time_needed AS DECIMAL(10,2))) AS total_time_needed
        FROM assignment_progress
        WHERE status = 'APPROVED'
        GROUP BY assignment_id
      ) ap_totals ON a.id = ap_totals.assignment_id
      WHERE a.emp_id = ?
    `;
    const params = [empId];
    if (projectId) {
      sql += ` AND a.project_id = ?`;
      params.push(projectId);
    }
    sql += ` ORDER BY p.project_name, a.task_name`;

    const rows = await query(sql, params);

    const excelRows = rows.map(r => {
      const assignedUnits = Number(r.units_assigned || 0);
      const completedUnits = Number(r.units_completed || 0);
      const pendingUnits = Number(r.units_pending || 0);
      const assignedHrs = Number(r.hours_assigned || 0);
      const utilizedHrs = Number(r.hours_utilized || 0);
      const pendingHrs = Math.max(assignedHrs - utilizedHrs, 0);

      const totalPD = Number((assignedHrs / 8).toFixed(2));
      const completedPD = Number((utilizedHrs / 8).toFixed(2));
      const pendingPD = Number((pendingHrs / 8).toFixed(2));

      const unitPct = assignedUnits > 0 ? Math.round((completedUnits / assignedUnits) * 100) : 0;
      const pdPct = totalPD > 0 ? Math.round((completedPD / totalPD) * 100) : 0;
      const hrsPct = assignedHrs > 0 ? Math.round((utilizedHrs / assignedHrs) * 100) : 0;

      return {
        "Employee Name": empName,
        "Project Name": r.project_name || "—",
        "Task Name": r.task_name || "—",
        "Total Units": assignedUnits,
        "Total Person Days": totalPD,
        "Completed Units": completedUnits,
        "Completed Person Days": completedPD,
        "Pending Units": pendingUnits,
        "Pending Person Days": pendingPD,
        "Unit Utilization (%)": `${unitPct}%`,
        "Person Days Utilization (%)": `${pdPct}%`,
        "Hours Utilization (%)": `${hrsPct}%`
      };
    });

    const worksheet = XLSX.utils.json_to_sheet(excelRows);
    worksheet["!cols"] = [
      { wch: 22 }, { wch: 26 }, { wch: 24 }, { wch: 14 },
      { wch: 18 }, { wch: 16 }, { wch: 22 }, { wch: 14 },
      { wch: 20 }, { wch: 20 }, { wch: 24 }, { wch: 20 }
    ];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Project Employee Utilization");

    const excelBuffer = XLSX.write(workbook, { bookType: "xlsx", type: "buffer" });
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", 'attachment; filename="Employee_Utilization_Project.xlsx"');
    return res.send(excelBuffer);

  } catch (err) {
    console.error("❌ exportEmployeeProjectUnit error:", err);
    return next(err);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// EXPORT: Overall Employee Utilization (Across All Projects) to Excel
// GET /api/utilization/export/employee-overall-unit?empId=
// ─────────────────────────────────────────────────────────────────────────────
const exportEmployeeOverallUnit = async (req, res, next) => {
  try {
    const { empId } = req.query;
    if (!empId) {
      return res.status(400).json({ message: "empId is required for export" });
    }

    // Resolve employee name
    const empInfo = await masterQuery(
      `SELECT emp_name FROM emp WHERE emp_id = ? LIMIT 1`,
      [empId]
    );
    const empName = empInfo[0]?.emp_name || empId;

    const sql = `
      SELECT
        p.project_name,
        a.task_name,
        a.units_assigned,
        a.estimated_hours                                 AS hours_assigned,
        COALESCE(ap_totals.units_completed, 0)            AS units_completed,
        GREATEST(a.units_assigned - COALESCE(ap_totals.units_completed, 0), 0) AS units_pending,
        COALESCE(ap_totals.total_time_needed, 0)          AS hours_utilized
      FROM assignments a
      LEFT JOIN projects p ON a.project_id = p.id
      LEFT JOIN (
        SELECT 
          assignment_id, 
          SUM(units_completed) AS units_completed,
          SUM(CAST(total_time_needed AS DECIMAL(10,2))) AS total_time_needed
        FROM assignment_progress
        WHERE status = 'APPROVED'
        GROUP BY assignment_id
      ) ap_totals ON a.id = ap_totals.assignment_id
      WHERE a.emp_id = ?
      ORDER BY p.project_name, a.task_name
    `;

    const rows = await query(sql, [empId]);

    const excelRows = rows.map(r => {
      const assignedUnits = Number(r.units_assigned || 0);
      const completedUnits = Number(r.units_completed || 0);
      const pendingUnits = Number(r.units_pending || 0);
      const assignedHrs = Number(r.hours_assigned || 0);
      const utilizedHrs = Number(r.hours_utilized || 0);
      const pendingHrs = Math.max(assignedHrs - utilizedHrs, 0);

      const totalPD = Number((assignedHrs / 8).toFixed(2));
      const completedPD = Number((utilizedHrs / 8).toFixed(2));
      const pendingPD = Number((pendingHrs / 8).toFixed(2));

      const unitPct = assignedUnits > 0 ? Math.round((completedUnits / assignedUnits) * 100) : 0;
      const pdPct = totalPD > 0 ? Math.round((completedPD / totalPD) * 100) : 0;
      const hrsPct = assignedHrs > 0 ? Math.round((utilizedHrs / assignedHrs) * 100) : 0;

      return {
        "Employee Name": empName,
        "Project Name": r.project_name || "—",
        "Task Name": r.task_name || "—",
        "Total Units": assignedUnits,
        "Total Person Days": totalPD,
        "Completed Units": completedUnits,
        "Completed Person Days": completedPD,
        "Pending Units": pendingUnits,
        "Pending Person Days": pendingPD,
        "Unit Utilization (%)": `${unitPct}%`,
        "Person Days Utilization (%)": `${pdPct}%`,
        "Hours Utilization (%)": `${hrsPct}%`
      };
    });

    const worksheet = XLSX.utils.json_to_sheet(excelRows);
    worksheet["!cols"] = [
      { wch: 22 }, { wch: 26 }, { wch: 24 }, { wch: 14 },
      { wch: 18 }, { wch: 16 }, { wch: 22 }, { wch: 14 },
      { wch: 20 }, { wch: 20 }, { wch: 24 }, { wch: 20 }
    ];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Overall Employee Utilization");

    const excelBuffer = XLSX.write(workbook, { bookType: "xlsx", type: "buffer" });
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", 'attachment; filename="Employee_Overall_Utilization.xlsx"');
    return res.send(excelBuffer);

  } catch (err) {
    console.error("❌ exportEmployeeOverallUnit error:", err);
    return next(err);
  }
};

module.exports = {
  getMyAssignments,
  logProgress,
  getPendingApprovals,
  approveProgress,
  rejectProgress,
  getOverallUtilization,
  getProjectUtilization,
  getProjectHealth,
  getProjectUnitSummary,
  getEmployeeUnitSummary,
  exportEmployeeProjectUnit,
  exportEmployeeOverallUnit,
};

