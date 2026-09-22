const express = require('express');
const router = express.Router();
const { syncHrmsTimesheets, getHrmsTimesheets,  getCategoryTimesheetsGroupedByEmployee, 
 } = require('../controller/projectTimesheet.controller');

// POST /api/hrms/sync-timesheets
// Body (optional): { "projectCodes": ["D:SS2:NC:GENACT", "I:A&A:SP:PROJCT"] }
router.post('/sync-timesheets', syncHrmsTimesheets);

// GET /api/hrms/timesheets?project_code=...&employee_id=...&from_date=...&to_date=...
router.get('/timesheets', getHrmsTimesheets);

router.get('/timesheets-by-category', getCategoryTimesheetsGroupedByEmployee); 

module.exports = router;