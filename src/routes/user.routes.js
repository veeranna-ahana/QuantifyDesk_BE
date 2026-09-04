const express = require('express');
const router = express.Router();

const userController = require('../controller/user.controller');

// POST / - create user
router.post('/', userController.addUser);

// GET / - get all users
router.get('/', userController.getAllUsers);

module.exports = router;
