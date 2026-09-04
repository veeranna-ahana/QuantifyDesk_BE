const express = require('express');
const router = express.Router();

const {authMiddleware } = require('../middleware/auth.middleware');
const { getDashboardSummary,getUserUtilization } = require('../controller/dashboard.controller');

// GET / - get dashboard summary (protected)
router.get('/', authMiddleware, getDashboardSummary);

router.get('/user-utilization', authMiddleware, getUserUtilization);

module.exports = router;