const { query } = require("../config/db");

// POST /users
exports.addUser = async (req, res) => {
  try {
    const { name, email } = req.body;

    if (!name || !email) {
      return res.status(400).json({ message: "Name and email are required" });
    }

    // Insert
    const insertSql = "INSERT INTO users (name, email) VALUES (?, ?)";
    const result = await query(insertSql, [name, email]);

    // Fetch created user
    const users = await query(
      "SELECT id, name, email FROM users WHERE id = ?",
      [result.insertId]
    );

    res.status(201).json({
      message: "User created",
      user: users[0],
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Internal server error" });
  }
};

// GET /users
// exports.getAllUsers = async (req, res) => {
//   try {
//     const users = await query(
//       "SELECT id, name, email,role,daily_capacity FROM users ORDER BY id ASC"
//     );
//     res.json(users);
//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ message: "Internal server error" });
//   }
// };
// GET /users
exports.getAllUsers = async (req, res) => {
  try {
    const users = await query(`
      SELECT 
        u.id,
        u.name,
        u.email,
        u.role,
        u.daily_capacity,
        GROUP_CONCAT(DISTINCT p.project_name) AS projects
      FROM users u
      LEFT JOIN tasks t ON t.assigned_user_id = u.id
      LEFT JOIN projects p ON p.id = t.project_id
      GROUP BY u.id
      ORDER BY u.id ASC
    `);

    res.json(users);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Internal server error" });
  }
};

