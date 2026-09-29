// Backend-maintained Project Type options for Import Project — Step 1
// (Project Info). Plain const list, not a DB table: these 3 values are
// fixed and rarely change, so a file here is enough — the point is just
// that the frontend no longer hardcodes them itself, it fetches this list
// from GET /api/import-project/project-types.
//
// To add/rename a project type, edit this array only — no DB migration,
// no frontend change needed. First entry is the default.
const PROJECT_TYPES = [
  "One Time Project",
  "Managed Service",
  "Staff Augmentation",
];

const DEFAULT_PROJECT_TYPE = PROJECT_TYPES[0];

module.exports = { PROJECT_TYPES, DEFAULT_PROJECT_TYPE };
