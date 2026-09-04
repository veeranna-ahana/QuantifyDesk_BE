const express = require("express");
const cors    = require("cors");
const swaggerUi = require("swagger-ui-express")
const authRoutes         = require("./routes/auth.routes");
const userRoutes         = require("./routes/user.routes");
const projectRoutes      = require("./routes/project.routes");
const taskRoutes         = require("./routes/task.routes");
const dailyUpdateRoutes  = require("./routes/dailyUpdate.routes");
const utilizationRoutes  = require("./routes/utilization.routes");
const dashboardRoutes    = require("./routes/dashboard.routes");
const assignmentRoutes   = require("./routes/assignment.routes");
const notificationRoutes = require("./routes/notification.routes"); // ← NEW
const timesheetRoutes = require("./routes/timesheet.routes");
const reconRoutes = require("./routes/recon.routes");
const swaggerSpec = require("../helpers/swagerConfig/swagger");
const hrmsApis = require("./routes/hrms.routes")


const app = express();
// Dummy Test API
app.get("/", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Server is running successfully",
    time: new Date()
  });
});

app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'workquantify-backend',
    ip: '127.0.0.1',
    port: 7001,
    timestamp: new Date().toISOString()
  });
});
const { getCustomers } = require("./controller/project.controller");
const { authMiddleware } = require("./middleware/auth.middleware");

app.use(cors());
app.use(express.json());
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));
app.use("/api/auth",          authRoutes);
app.use("/api/users",         userRoutes);
app.use("/api/projects",      projectRoutes);
app.use("/api/customers",     authMiddleware, getCustomers);
app.use("/api/tasks",         taskRoutes);
app.use("/api/daily-updates", dailyUpdateRoutes);
app.use("/api/utilization",   utilizationRoutes);
app.use("/api/dashboard",     dashboardRoutes);
app.use("/api/assignments",   assignmentRoutes);
app.use("/api/notifications", notificationRoutes); // ← NEW
app.use("/api/timesheet", timesheetRoutes);
app.use("/api/recon", reconRoutes);
app.use("/api/hrms", hrmsApis)

// Global error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ message: err.message || "Internal server error" });
});

module.exports = app;
