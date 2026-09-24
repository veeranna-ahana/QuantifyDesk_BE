const express = require("express");
const router = express.Router();

const { authMiddleware, adminOnly } = require("../middleware/auth.middleware");
const {
  fetchStoredPmsProjects,
  fetchProjectTasks,
} = require("../controller/dailyReport.controller");

router.get("/stored-projects", authMiddleware, fetchStoredPmsProjects);

router.get("/project-tasks", authMiddleware, fetchProjectTasks);

module.exports = router;
