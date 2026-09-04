const { query } = require('../config/db');

// ── Shared helper used by other controllers to create a notification ──────────
// Call this from assignment.controller.js after inserting an assignment
const createNotification = async ({ user_id, type = 'info', title, message }) => {
  await query(
    `INSERT INTO notifications (user_id, type, title, message) VALUES (?, ?, ?, ?)`,
    [user_id, type, title, message]
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/notifications?userId=
// Returns all notifications for the user, newest first
// ─────────────────────────────────────────────────────────────────────────────
const getNotifications = async (req, res, next) => {
  try {
    const userId = req.user.id; // from JWT — never trust query param for this

    const rows = await query(
      `SELECT id, type, title, message, is_read, created_at
       FROM notifications
       WHERE user_id = ?
       ORDER BY created_at DESC
       LIMIT 50`,
      [userId]
    );

    return res.status(200).json(rows);
  } catch (err) {
    return next(err);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/notifications/unread-count
// Returns just the unread count — polled by the bell icon
// ─────────────────────────────────────────────────────────────────────────────
const getUnreadCount = async (req, res, next) => {
  try {
    // ✅ Check if user exists and has id
    const userId = req.user?.id || req.user?.userid;
    
    if (!userId) {
      console.warn("⚠️ getUnreadCount: No user ID found in request");
      return res.status(200).json({ count: 0 });
    }

    // ✅ Ensure userId is a valid number
    const userIdNum = parseInt(userId);
    if (isNaN(userIdNum) || userIdNum <= 0) {
      console.warn("⚠️ getUnreadCount: Invalid user ID:", userId);
      return res.status(200).json({ count: 0 });
    }

    const rows = await query(
      `SELECT COUNT(*) AS count FROM notifications WHERE user_id = ? AND is_read = 0`,
      [userIdNum]
    );

    return res.status(200).json({ count: rows[0]?.count || 0 });
    
  } catch (err) {
    console.error("❌ getUnreadCount error:", err.message);
    // ✅ Always return a valid response, don't throw
    return res.status(200).json({ count: 0 });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/notifications/:id/read
// Mark one notification as read
// ─────────────────────────────────────────────────────────────────────────────
const markRead = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId  = req.user.id;

    await query(
      `UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?`,
      [id, userId]
    );

    return res.status(200).json({ message: 'Marked as read' });
  } catch (err) {
    return next(err);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/notifications/mark-all-read
// Mark all notifications as read for the logged-in user
// ─────────────────────────────────────────────────────────────────────────────
const markAllRead = async (req, res, next) => {
  try {
    const userId = req.user.id;

    await query(
      `UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0`,
      [userId]
    );

    return res.status(200).json({ message: 'All marked as read' });
  } catch (err) {
    return next(err);
  }
};

module.exports = {
  createNotification, // exported for use in other controllers
  getNotifications,
  getUnreadCount,
  markRead,
  markAllRead,
};
