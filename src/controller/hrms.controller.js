const axios = require("axios");

// Raw HRMS employee rows (every status, not just Active) are cached for a short window — name
// resolution (getEmployeeNameMapFromHRMS) can now run once per request against dozens of rows
// (effort_estimate rows, document uploaders, utilization rows, etc.), and each call is two
// sequential external HTTP round-trips (GetToken, then GetAllEmployeeData) to a third-party API,
// so a page that touches several of those endpoints at once (Project Overview, Utilization
// dashboard) would otherwise refetch the entire HRMS roster several times over in a few seconds.
let hrmsRowsCache = { rows: null, fetchedAt: 0 };
const HRMS_CACHE_TTL_MS = 60 * 1000;

const fetchHRMSEmployeeRows = async () => {
  const now = Date.now();
  if (hrmsRowsCache.rows && now - hrmsRowsCache.fetchedAt < HRMS_CACHE_TTL_MS) {
    return hrmsRowsCache.rows;
  }

  const tokenResponse = await axios.post(
    "https://hr.hwtpl.com/AhanaApi/Ahana/GetToken",
    {
      EncKey1: process.env.EncKey1,
      EncKey2: process.env.EncKey2,
    },
    {
      headers: {
        "Content-Type": "application/json",
        Cookie: "ASP.NET_SessionId=im0vi4l3zk0tnkkbzzmalinv",
      },
    },
  );

  const token = tokenResponse.data.data[0].Table[0].Token;

  const employeeResponse = await axios.post(
    "https://hr.hwtpl.com/AhanaApi/Ahana/GetAllEmployeeData",
    {
      Token: token,
      UniqueId: "29293",
    },
    {
      headers: {
        "Content-Type": "application/json",
        Cookie: "ASP.NET_SessionId=im0vi4l3zk0tnkkbzzmalinv",
      },
    },
  );

  const rows = employeeResponse.data.data[0].rows || [];
  hrmsRowsCache = { rows, fetchedAt: now };
  return rows;
};

// Active-only subset, for places that must only offer/consider currently active employees (e.g.
// the Effort Estimate "+ Add Member" picker) rather than resolving a name for someone already on
// record (which must work for inactive/offboarded employees too — see getEmployeeNameMapFromHRMS).
const fetchActiveHRMSEmployeeRows = async () => {
  const rows = await fetchHRMSEmployeeRows();
  return rows.filter((employee) => employee.Employee_Status === "Active");
};

// emp_id -> emp_name map built from HRMS, covering EVERY employee status (not just Active) — used
// anywhere a stored emp_id (effort_estimate, document uploaded_by, assignments, etc.) needs its
// display name resolved, including for an employee who has since left/gone inactive, where an
// active-only lookup would wrongly come up empty.
const getEmployeeNameMapFromHRMS = async () => {
  const rows = await fetchHRMSEmployeeRows();
  const map = new Map();
  rows.forEach((employee) => {
    const id = String(employee.Employee_ID || "").trim();
    const name = String(employee.Employee_Name || "").trim();
    if (id && name) map.set(id, name);
  });
  return map;
};

const getAllAhanaEmplist = async (req, res) => {
  try {
    const activeRows = await fetchActiveHRMSEmployeeRows();

    // Extract only required fields
    const simplifiedData = activeRows
      .map((employee) => ({
        Employee_ID: employee.Employee_ID,
        Employee_Name: employee.Employee_Name,
        Employee_Email: employee.Employee_Official_Email_ID,
        Name_of_Department: employee.Name_of_Department,
        Employee_Status: employee.Employee_Status,
        Reporting_Manager_Employee_ID: employee.Reporting_Manager_Employee_ID,
        Reporting_Manager_Name: employee.Reporting_Manager_Name,
      }))
      .sort((a, b) => a.Employee_Name.localeCompare(b.Employee_Name));

    res.json({
      success: true,
      message: "",
      data: simplifiedData,
    });
  } catch (error) {
    // console.log(error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Active employee list (emp_id/emp_name only) sourced from HRMS, for places that need a plain
// id/name picker (e.g. the Effort Estimate "+ Add Member" dropdown) without the full Ahana
// employee shape getAllAhanaEmplist returns over HTTP.
const getActiveEmployeesFromHRMS = async () => {
  const activeRows = await fetchActiveHRMSEmployeeRows();
  return (
    activeRows
      // Some "Active" HRMS rows carry a blank/whitespace-only Employee_ID or Employee_Name (e.g.
      // placeholder/service rows) — those rendered as empty, unselectable entries in the "+ Add
      // Member" dropdown (sorting to the top, ahead of real names). Drop anything without a real
      // id and name before this ever reaches the frontend.
      .filter(
        (employee) =>
          String(employee.Employee_ID || "").trim() &&
          String(employee.Employee_Name || "").trim(),
      )
      .map((employee) => ({
        emp_id: employee.Employee_ID,
        emp_name: employee.Employee_Name.trim(),
      }))
      .sort((a, b) => a.emp_name.localeCompare(b.emp_name))
  );
};

const getEmployeeDetailsFromHRMS = async (emp_id) => {
  try {
    const activeRows = await fetchActiveHRMSEmployeeRows();

    const employee = activeRows.find((emp) => emp.Employee_ID == emp_id);

    if (!employee) return null;

    return {
      department: employee.Name_of_Department,
      designation: employee.Employee_Designation,
    };
  } catch (err) {
    console.warn("HRMS API failed:", err.message);
    return null;
  }
};

module.exports = {
  getAllAhanaEmplist,
  getEmployeeDetailsFromHRMS,
  getActiveEmployeesFromHRMS,
  getEmployeeNameMapFromHRMS,
};
