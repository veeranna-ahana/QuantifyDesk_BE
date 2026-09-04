const axios = require('axios');

const getAllAhanaEmplist = async (req, res) => {
  try {
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
console.log("employeeResponse",employeeResponse.data.data[0].rows);

    // Extract only required fields AND filter for active employees
    const simplifiedData = employeeResponse.data.data[0].rows
      .filter((employee) => employee.Employee_Status === "Active")
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
    console.log(error)
    res.status(500).json({ success: false, error: error.message });
  }
};


const getEmployeeDetailsFromHRMS = async (emp_id) => {
  try {
    const tokenResponse = await axios.post(
      "https://hr.hwtpl.com/AhanaApi/Ahana/GetToken",
      {
        EncKey1: process.env.EncKey1,
        EncKey2: process.env.EncKey2,
      },
      { headers: { "Content-Type": "application/json" } }
    );

    const token = tokenResponse.data.data[0].Table[0].Token;

    const employeeResponse = await axios.post(
      "https://hr.hwtpl.com/AhanaApi/Ahana/GetAllEmployeeData",
      {
        Token: token,
        UniqueId: "29293",
      },
      { headers: { "Content-Type": "application/json" } }
    );

    const employees = employeeResponse.data.data[0].rows || [];

    const employee = employees.find(
      (emp) =>
        emp.Employee_ID == emp_id &&
        emp.Employee_Status === "Active"
    );

    if (!employee) return null;

    return {
      department: employee.Name_of_Department,
      designation: employee.Employee_Designation
    };
  } catch (err) {
    console.warn("HRMS API failed:", err.message);
    return null;
  }
};

module.exports = {
    getAllAhanaEmplist,
    getEmployeeDetailsFromHRMS
}