const express = require('express');
const router = express.Router();
const {
  getFilteredTimesheetData,
} = require('../controller/timesheetHRMS.controller');

// Route to export timesheet data to Excel for specific project category
router.post("/timesheet/export", getFilteredTimesheetData);



module.exports = router;