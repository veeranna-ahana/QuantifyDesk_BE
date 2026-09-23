require('dotenv').config();
const app = require("./app");

// ─── Start scheduled jobs ───
const { startHrmsSyncJob } = require('../services/hrmsSyncJob');
startHrmsSyncJob();

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

