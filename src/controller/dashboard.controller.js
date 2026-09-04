const { query } = require('../config/db');

// GET /dashboard/summary
const getDashboardSummary = async (req, res, next) => {
  try {
    // Total Users
    const usersResult = await query('SELECT COUNT(*) AS total FROM users');
    const totalUsers = usersResult[0]?.total || 0;

    // Total Projects
    const projectsResult = await query('SELECT COUNT(*) AS total FROM projects');
    const totalProjects = projectsResult[0]?.total || 0;

    // Total Tasks
    const tasksResult = await query('SELECT COUNT(*) AS total FROM tasks');
    const totalTasks = tasksResult[0]?.total || 0;

    // Total Hours
    const hoursResult = await query(
      'SELECT COALESCE(SUM(hours_spent), 0) AS total FROM daily_updates'
    );
    const totalHours = hoursResult[0]?.total || 0;

    // Total Units Completed
    const unitsResult = await query(
      'SELECT COALESCE(SUM(units_completed), 0) AS total FROM daily_updates'
    );
    const totalUnits = unitsResult[0]?.total || 0;

    // Overall Utilization (All Users Combined)
    const capacityResult = await query(
      'SELECT COALESCE(SUM(daily_capacity), 0) AS total_capacity FROM users'
    );
    const totalCapacity = capacityResult[0]?.total_capacity || 0;

    const overallUtilization =
      totalCapacity > 0
        ? ((totalHours / totalCapacity) * 100).toFixed(2)
        : 0;

    return res.status(200).json({
      total_users: totalUsers,
      total_projects: totalProjects,
      total_tasks: totalTasks,
      total_hours: totalHours,
      total_units_completed: totalUnits,
      overall_utilization_percentage: overallUtilization,
    });

  } catch (err) {
    return next(err);
  }
};

// POST /api/daily-updates — add a new daily update
const getUserUtilization = async (req, res, next) => {
  try {
    const range = req.query.range || 'monthly';

    let dateCondition = '';

    if (range === 'today') {
      dateCondition = 'AND d.date = CURDATE()';
    } else if (range === 'weekly') {
      dateCondition = 'AND YEARWEEK(d.date, 1) = YEARWEEK(CURDATE(), 1)';
    } else {
      dateCondition = `
        AND MONTH(d.date) = MONTH(CURDATE()) 
        AND YEAR(d.date) = YEAR(CURDATE())
      `;
    }

    const sql = `
      SELECT 
        u.id,
        u.name,
        u.daily_capacity,
        COALESCE(SUM(d.hours_spent), 0) AS total_hours,
        COUNT(DISTINCT d.date) AS working_days,
        GROUP_CONCAT(DISTINCT p.project_name) AS projects
      FROM users u
      LEFT JOIN daily_updates d 
        ON u.id = d.user_id ${dateCondition}
      LEFT JOIN tasks t 
        ON t.assigned_user_id = u.id
      LEFT JOIN projects p 
        ON p.id = t.project_id
      GROUP BY u.id, u.name, u.daily_capacity
    `;

    const rows = await query(sql);

    const result = rows.map((row) => {
      const availableHours = row.daily_capacity * row.working_days;

      const utilization =
        availableHours > 0
          ? ((row.total_hours / availableHours) * 100).toFixed(2)
          : 0;

      return {
        user_id: row.id,
        name: row.name,
        total_hours: row.total_hours,
        working_days: row.working_days,
        daily_capacity: row.daily_capacity,
        available_hours: availableHours,
        utilization_percentage: utilization,
        projects: row.projects
          ? row.projects.split(',')
          : []
      };
    });

    return res.status(200).json(result);

  } catch (err) {
    return next(err);
  }
};



module.exports = {
  getDashboardSummary,getUserUtilization
};
