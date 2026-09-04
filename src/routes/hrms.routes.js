const express = require('express');
const router = express.Router();
const { getAllAhanaEmplist } = require('../controller/hrms.controller');

router.post("/getAllAhanaEmplist", getAllAhanaEmplist);

module.exports = router;