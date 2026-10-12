// Fixed option lists for the Server Information screens. Kept here (not hard-coded in the
// frontend) so they can change without a frontend deploy — GET /api/servers/options serves them
// to the Add / Edit Server dropdowns, and the create / update endpoints validate against them.

const ENVIRONMENTS = ["Production", "UAT", "QA", "Development"];

const SERVER_STATUSES = ["Active", "Maintenance", "Not Active"];

const OPERATING_SYSTEMS = [
  "Linux (Ubuntu / RHEL / Debian)",
  "Ubuntu 22.04 LTS",
  "Ubuntu 20.04 LTS",
  "Debian 12",
  "CentOS Stream 9",
  "Red Hat Enterprise Linux 9",
  "Amazon Linux 2023",
  "Windows Server 2022",
  "Windows Server 2019",
];

// Pre-selected on a new server
const SERVER_DEFAULTS = {
  operatingSystem: "Linux (Ubuntu / RHEL / Debian)",
  environment: "Production",
  status: "Active",
};

module.exports = {
  ENVIRONMENTS,
  SERVER_STATUSES,
  OPERATING_SYSTEMS,
  SERVER_DEFAULTS,
};
