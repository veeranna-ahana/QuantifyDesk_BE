// Single source of truth for the effort/buffer days -> hours conversion used by Effort
// Estimate (Import Project Step 3). effort_hours/buffer_hours/total_hours are computed from
// this at write time and STORED on the effort_estimate row (not recomputed at read time), so a
// historical estimate's hours stay correct even if this constant changes later.
const HRS_PER_DAY = 8;

module.exports = { HRS_PER_DAY };
