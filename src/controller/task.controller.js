const { query } = require('../config/db');

// Create a task
// Expect body: { project_id, title, description, status, due_date }
const createTask = async (req, res, next) => {
  try {
    const { project_id, assigned_user_id, task_name, planned_units } = req.body;

    const sql = `
      INSERT INTO tasks 
      (project_id, assigned_user_id, task_name, planned_units)
      VALUES (?, ?, ?, ?)
    `;

    const result = await query(sql, [
      project_id,
      assigned_user_id,
      task_name,
      planned_units,
    ]);

    return res.status(201).json({
      id: result.insertId,
      project_id,
      assigned_user_id,
      task_name,
      planned_units,
    });
  } catch (err) {
    return next(err);
  }
};


// Get tasks by project_id
// Assume route like: GET /projects/:projectId/tasks
const getTasksByProjectId = async (req, res, next) => {
  try {
    const { projectId } = req.params;

    const sql = `
     SELECT 
        id,
        project_id,
        assigned_user_id,
        task_name,
        planned_units
      FROM tasks
      WHERE project_id = ?
      ORDER BY id ASC
    `;
    const tasks = await query(sql, [projectId]);

    return res.status(200).json(tasks);
  } catch (err) {
    return next(err);
  }
};

module.exports = {
  createTask,
  getTasksByProjectId,
};