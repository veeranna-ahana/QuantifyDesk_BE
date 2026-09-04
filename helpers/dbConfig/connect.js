const mysql = require("mysql2");
require("dotenv").config();

const pool = mysql.createPool({
  connectionLimit: 30,
  port: "3306",
  host: process.env.HOST_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: "master",
});

const pool1 = mysql.createPool({
  connectionLimit: 30,
  port: "3306",
  host: process.env.HOST_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: " ",
});


module.exports = { pool,pool1 };
