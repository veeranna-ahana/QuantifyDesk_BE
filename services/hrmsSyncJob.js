const cron = require('node-cron');
const { runHrmsSync } = require('../services/hrmsSyncService');

// Schedule: every day at 2:00 AM server time.
// Cron syntax: minute hour day-of-month month day-of-week
//   0 2 * * *  → 02:00 every day
const CRON_SCHEDULE = process.env.HRMS_SYNC_CRON || '0 11 * * *';

function startHrmsSyncJob() {
  console.log(`⏰ HRMS sync cron scheduled: "${CRON_SCHEDULE}"`);

  const task = cron.schedule(CRON_SCHEDULE, async () => {
    const startedAt = new Date();
    console.log(`\n🕐 [${startedAt.toISOString()}] HRMS cron sync starting...`);

    try {
      const result = await runHrmsSync();
      const endedAt = new Date();
      const durationSec = ((endedAt - startedAt) / 1000).toFixed(1);

      console.log(
        `🏁 HRMS cron sync done in ${durationSec}s: ` +
          `succeeded=${result.summary.succeeded} failed=${result.summary.failed} ` +
          `fetched=${result.summary.total_fetched} inserted=${result.summary.total_inserted} ` +
          `updated=${result.summary.total_updated} unchanged=${result.summary.total_unchanged}`
      );
    } catch (err) {
      console.error('❌ HRMS cron sync failed:', err.message);
    }
  });

  return task;
}

module.exports = { startHrmsSyncJob };