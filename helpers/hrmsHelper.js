// Convert HRMS DD/MM/YYYY → YYYY-MM-DD, or null if invalid
function parseHrmsDate(value) {
  if (!value || typeof value !== 'string') return null;
  const m = value.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const [, dd, mm, yyyy] = m;
  return `${yyyy}-${mm}-${dd}`;
}

function toNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Flatten HRMS GetTimeSheetData response into an array of row objects
 * ready to insert into hrms_timesheet.
 */
function normalizeHrmsTimesheet(hrmsResponse) {
  const rows = [];

  const data = hrmsResponse?.data;
  if (!Array.isArray(data)) return rows;

  // ✅ HRMS can return either:
  //   data = [ { EmployeeInformation, ProjectDetails }, ... ]
  //   data = [ [ { EmployeeInformation, ProjectDetails }, ... ] ]
  // Flatten one level if the first element is itself an array.
  const groups = Array.isArray(data[0]) ? data[0] : data;

  for (const group of groups) {
    const info = group?.EmployeeInformation || {};
    const details = Array.isArray(group?.ProjectDetails) ? group.ProjectDetails : [];

    for (const d of details) {
      rows.push({
        employee_id: info.employee_id || null,
        employee_name: info.employee_name || null,
        designation: info.designation || null,
        department: info.department || null,
        employee_email: info.employee_email || null,
        employee_phone: info.employee_phone || null,
        reporting_manager: info.reporting_manager || null,
        employment_type: info.employment_type || null,

        project_code: d.project_code || null,
        project_name: d.project_name || null,
        projectcategory_code: d.projectcategory_code || null,
        projectcategory_name: d.projectcategory_name || null,

        from_date: parseHrmsDate(d['From Date']),
        to_date: parseHrmsDate(d['To Date']),
        number_of_hours: toNumber(d.number_of_hours),

        approval_status: d.approval_status || null,
        approved_by: d.approved_by || null,
        submitted_on: parseHrmsDate(d.submitted_on),
        approved_on: parseHrmsDate(d.approved_on),
        remarks: d.remarks || null,
      });
    }
  }

  return rows;
}

module.exports = { parseHrmsDate, normalizeHrmsTimesheet };