const winston = require("winston");
const { format } = require("winston");
const moment = require("moment-timezone");
const DailyRotateFile = require("winston-daily-rotate-file");
const path = require("path");

// Define a custom timestamp format function for IST
const customTimestamp = format((info) => {
  info.timestamp = moment().tz("Asia/Kolkata").format();
  return info;
});

// Logger files path config
const logDir = path.join(__dirname, "../loggers");

// Create an info logger with daily rotation
const infoLogger = winston.createLogger({
  transports: [
    new DailyRotateFile({
      filename: path.join(logDir, "info-%DATE%.log"),
      datePattern: "YYYY-MM-DD",
      level: "info",
      format: format.combine(
        format.timestamp(),
        customTimestamp(),
        format.json(),
        format.prettyPrint()
      ),
    }),
  ],
});

// Create an error logger with daily rotation
const errorLogger = winston.createLogger({
  transports: [
    new DailyRotateFile({
      filename: path.join(logDir, "error-%DATE%.log"),
      datePattern: "YYYY-MM-DD",
      level: "error",
      format: format.combine(
        format.timestamp(),
        customTimestamp(),
        format.json(),
        format.prettyPrint()
      ),
    }),
  ],
});

// Log info level messages
function infoLog(endpoint, res) {
  return infoLogger.info(`Successful response from ${endpoint}`);
}

// Log error level messages
function errorLog(endpoint, error) {
  return errorLogger.error(
    `Failure in ${endpoint} : ${error.message || error}`,
  );
}

module.exports = { infoLog, errorLog };
