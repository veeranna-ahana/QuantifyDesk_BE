
const express = require('express');
const router = express.Router();

const { authMiddleware, adminOnly } = require('../middleware/auth.middleware');
const {
  fetchStoredPmsProjects,
  fetchProjectTasks
} = require('../controller/dailyReport.controller');

router.get('/stored-projects', fetchStoredPmsProjects); 

router.get('/project-tasks', fetchProjectTasks);

module.exports = router;