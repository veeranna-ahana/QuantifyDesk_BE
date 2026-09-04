const express = require('express');
const router  = express.Router();

const { authMiddleware }  = require('../middleware/auth.middleware');
const {
  getNotifications,
  getUnreadCount,
  markRead,
  markAllRead,
} = require('../controller/notification.controller');

router.get ('/unread-count',       authMiddleware, getUnreadCount);
router.get ('/',                   authMiddleware, getNotifications);
router.put ('/mark-all-read',      authMiddleware, markAllRead);
router.put ('/:id/read',           authMiddleware, markRead);

module.exports = router;
