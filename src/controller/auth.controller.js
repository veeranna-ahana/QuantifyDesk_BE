const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const https = require('https');
const { query, masterQuery } = require('../config/db');
const { pool } = require("../../helpers/dbConfig/connect");
const { infoLog, errorLog } = require("../../middleware/logger");
const axios = require('axios');
const {
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
} = require("../../helpers/helperFunctions/authHelper");

const SALT_ROUNDS = 10;

// Express route handler - receives (req, res)
const login = async (req, res) => {
  const { email, password, emp_id } = req.body;
  const authToken = req.headers.authorization?.replace("Bearer ", "");

  console.log("Login endpoint called with:", { email, password: password ? "***" : "none", emp_id, authToken: authToken ? "present" : "missing" });

  try {
    // Require either password OR authToken
    if (!password && !authToken) {
      return res.status(400).json({
        status: "error",
        success: false,
        message: "Either password or Authorization token is required",
      });
    }

    // Build query based on emp_id or email
    let dbQuery, params;

    if (emp_id) {
      dbQuery = `
        SELECT emp_email, emp_pwd, emp_id, u_id, flag, emp_name
        FROM master.emp
        WHERE emp_id = ?
        ORDER BY flag = 'Active' DESC
        LIMIT 1
      `;
      params = [emp_id];
    } else if (email) {
      dbQuery = `
        SELECT emp_email, emp_pwd, emp_id, u_id, flag, emp_name
        FROM master.emp
        WHERE emp_email = ?
        ORDER BY flag = 'Active' DESC
        LIMIT 1
      `;
      params = [email];
    } else {
      return res.status(400).json({
        status: "error",
        success: false,
        message: "Either email or emp_id is required",
      });
    }

    // Query database
    const [result] = await pool.promise().query(dbQuery, params);
    
    if (!result || !result.length) {
      return res.status(401).json({
        status: "error",
        success: false,
        message: "User not found",
      });
    }

    const user = result[0];
    
    if (user.flag !== "Active") {
      return res.status(401).json({
        status: "error",
        success: false,
        message: "User is not active",
      });
    }

    // Password authentication (if password provided)
    if (password) {
      const passwordMatch = await bcrypt.compare(password, user.emp_pwd);
      if (!passwordMatch) {
        return res.status(401).json({
          status: "error",
          success: false,
          message: "Invalid password",
        });
      }
    }

    // Fetch RBC/RBAC details (with or without authToken)
    let rbacData = null;
    let departmentData = [];
    let serviceDeliveryEmployees = []; // For CR: Store Service Delivery employees

    const baseURL = process.env.RBAC_API_URL;
    
    if (baseURL) {
      try {
        const headers = authToken 
          ? { Authorization: `Bearer ${authToken}` }
          : {};

        console.log("🔑 RBAC Request Headers:", {
          hasToken: !!authToken,
          tokenPrefix: authToken ? authToken.substring(0, 20) + "..." : "none",
        });

        const instance = axios.create({
          baseURL,
          httpsAgent: new https.Agent({ rejectUnauthorized: false }),
          timeout: 8000,
          headers,
        });

        // Fetch RBAC roles (works with or without token)
        try {
          const rbacResponse = await instance.get(
            "/employee_role_associate/get-current-employees-role-details"
          );
          rbacData = rbacResponse.data;
          console.log("🔐 Fetched RBAC data successfully");
        } catch (rbacError) {
          console.warn("⚠️ RBAC fetch failed (attempt 1):", rbacError.message);
          
          // Fallback: Try with emp_id parameter
          if (emp_id) {
            try {
              console.log("📍 Trying RBAC with emp_id parameter:", emp_id);
              const fallbackResponse = await instance.get(
                "/employee_role_associate/get-current-employees-role-details",
                { params: { employee_id: emp_id } }
              );
              rbacData = fallbackResponse.data;
              console.log("✅ Fetched RBAC data via emp_id fallback");
            } catch (fallbackError) {
              console.warn("⚠️ RBAC fallback also failed:", fallbackError.message);
              rbacData = null;
            }
          }
        }

        // Fetch departments (only with authToken)
        if (authToken) {
          let departments = [];
          try {
            const deptListResponse = await instance.get("/department_admin/get-departments");
            departments = deptListResponse.data?.departments || [];
            console.log("📦 Fetched departments:", departments);
            // console.log("📦 Fetched departments:", departments.length);
          } catch (deptError) {
            console.warn("⚠️ Department fetch failed:", deptError.message);
            departments = [];
          }

          // Fetch employee department associations
          let deptEmployeeResponses = [];
          let allDepartmentEmployees = [];
          if (departments.length) {
            const deptPromises = departments.map((dept) =>
              instance.get(
                "/employee_department_association/get-employees-by-department-id",
                { params: { department_id: dept.department_id } }
              ).catch(e => ({ status: "rejected", reason: e }))
            );
            deptEmployeeResponses = await Promise.allSettled(deptPromises);
          }

          deptEmployeeResponses.forEach((res, index) => {
            if (res.status === "fulfilled" && res.value?.data) {
              const employees = res.value.data?.data || [];
              console.log("Current Department:", departments[index].department_name);
              // New code for CR
if (departments[index].department_name === "Service Delivery") {
  console.log("Service Delivery Employees:", employees.map((emp) => emp.emp_name));

  serviceDeliveryEmployees = employees;
}
              // Store all employees for CR (without affecting existing logic)
allDepartmentEmployees.push({
  department_id: departments[index].department_id,
  department_name: departments[index].department_name,
  employees,
});
               console.log(
      `Department ${departments[index].department_name} (${departments[index].department_id}) has ${employees.length} employees`
    );

    console.log("Employee List:", employees);
              const match = employees.find((emp) => emp.employee_id === user.emp_id);
              if (match) {
                departmentData.push({
                  employee_id: match.employee_id,
                  emp_name: match.emp_name,
                  department_id: match.department_id,
                  department_name: match.department_name,
                });
              }
              //fetching all emp by department
            }
          });

          // console.log("All Department Employees:", allDepartmentEmployees);
          console.log(
  "All Department Employees:",
  JSON.stringify(allDepartmentEmployees, null, 2)
);

          // Remove duplicate departments
          departmentData = Array.from(
            new Map(departmentData.map((d) => [d.department_id, d])).values()
          );
          console.log("🏢 Processed departments:", departmentData.length);
        }

      } catch (err) {
        console.error("❌ RBC/RBAC fetch error:", err.message);
        rbacData = null;
        departmentData = [];
      }
    } else {
      console.warn("⚠️ RBAC_API_URL not configured in .env");
    }

    // Process login result
    const loginResult = processUserLoginWithRBAC(
      user,
      rbacData,
      departmentData
    );

    // ✅ Using emp_id from master.emp - No users table dependency
    const empIdForLookup = loginResult.result[0]?.emp_id || user.emp_id;
    // localUserId is no longer needed - removed users table dependency

    // Generate tokens
    const tokenPayload = {
      emp_id: empIdForLookup,
      userid: loginResult.userid,
      // id: localUserId, // ❌ Removed - no users table dependency
      role_id: loginResult.result[0]?.role_id || 0,
    };

    const accessToken = generateAccessToken(tokenPayload);
    const refreshToken = generateRefreshToken(tokenPayload);

    // Set refresh token in HTTP-only cookie
    res.cookie(process.env.COOKIE_NAME || "refreshToken", refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    console.log("✅ Login successful for:", user.emp_email, "| Emp ID:", empIdForLookup);
    
    return res.status(200).json({
      status: "success",
      success: true,
      message: "Login successful",
      userid: loginResult.userid,
      // id: localUserId, // ❌ Removed - no users table dependency
      accessToken,
      result: loginResult.result,
      source: loginResult.source,
      departments: departmentData,
      serviceDeliveryEmployees: serviceDeliveryEmployees, // For CR: Return Service Delivery employees
    });

  } catch (error) {
    console.error("❌ Login error:", error.message);
    return res.status(500).json({
      status: "error",
      success: false,
      message: error.message || "Login failed",
      result: null,
    });
  }
};

const processUserLoginWithRBAC = (userRecord, rbacData, departmentData) => {
  const emp_id = userRecord.emp_id;
  const userid = `${userRecord.u_id}_${emp_id}`;

  console.log("🎯 Processing login with RBAC data:", {
    emp_id,
    rbacDataType: typeof rbacData,
    rbacDataIsArray: Array.isArray(rbacData),
    rbacDataKeys: rbacData ? Object.keys(rbacData).slice(0, 5) : "null",
  });

  const rbacArray = Array.isArray(rbacData)
    ? rbacData
    : Array.isArray(rbacData?.associations)
      ? rbacData.associations
      : Array.isArray(rbacData?.data)
        ? rbacData.data
        : [];

  const appName = process.env.RBAC_APPLICATION_NAME || "QuantifyTool";

  // Log all fetched roles for debugging
  console.log("📊 RBAC Data Fetched:", {
    totalRoles: rbacArray.length,
    appNameLooking: appName,
    allApplications: rbacArray.map(r => r.application_name).filter((v, i, a) => a.indexOf(v) === i),
  });

  if (rbacArray.length > 0) {
    console.log("📋 Sample roles from RBAC:", rbacArray.slice(0, 3).map(r => ({
      role_name: r.role_name,
      application_name: r.application_name,
      is_active: r.is_active,
    })));
  }

  const roles = rbacArray.filter(
    (role) => role.application_name === appName && role.is_active === true
  );

  console.log("✔️ Filtered roles for", appName + ":", roles.length);

  const departments = (departmentData || []).map((dept) => ({
    employee_id: dept.employee_id,
    emp_name: dept.emp_name,
    department_id: dept.department_id,
    department_name: dept.department_name,
  }));

  if (roles.length > 0) {
    const rolesArray = roles.map((role) => {
      // Normalize role name: capitalize first letter
      const normalizedRole = role.role_name.charAt(0).toUpperCase() + role.role_name.slice(1).toLowerCase();
      
      console.log(`✅ USER: ${userRecord.emp_name} → ROLE: "${normalizedRole}" (from RBAC: "${role.role_name}")`);
      
      return {
        emp_id,
        emp_name: userRecord.emp_name,
        emp_email: userRecord.emp_email,
        role: normalizedRole,
        designation: role.role_name,
        role_id: role.role_id,
        association_id: role.association_id,
        status: 1,
        departments,
      };
    });
    
    return {
      status: "success",
      userid,
      result: rolesArray,
      source: "rbac",
      message: "Login successful via RBAC",
    };
  }

  // Default role for users with no RBAC role
  console.warn(`⚠️ USER: ${userRecord.emp_name} → NO ${appName} ROLE. Using default: Employee`);
  return {
    status: "success",
    userid,
    result: [
      {
        emp_id,
        emp_name: userRecord.emp_name,
        emp_email: userRecord.emp_email,
        role: "User",
        designation: "User",
        role_id: null,
        association_id: null,
        status: 1,
        departments,
      },
    ],
    source: "default",
    message: `No ${appName} roles found. Using default role.`,
  };
};

// const Login = async (req, res) => {
//   let { emp_email, emp_password, emp_id } = req.body.userData || req.body;

//   const authToken = req.headers.authorization?.replace("Bearer ", "");
//   const useTokenAuth = authToken && !emp_password;

//   if (useTokenAuth) {
//     let query, params;

//     if (emp_id) {
//       query = `
//         SELECT emp_id, emp_pwd, u_id, flag, emp_name 
//         FROM master.emp 
//         WHERE emp_id = ?
//       `;
//       params = [emp_id];
//     } else if (emp_email) {
//       query = `
//         SELECT emp_id, emp_pwd, u_id, flag, emp_name 
//         FROM master.emp 
//         WHERE emp_email = ?
//       `;
//       params = [emp_email];
//     } else {
//       return res.status(400).json({
//         status: "failed",
//         message: "Either emp_email or emp_id is required",
//       });
//     }

//     try {
//       const [result] = await pool.promise().query(query, params);

//       if (!result || result.length === 0) {
//         return res.status(401).json({
//           result: "Invalid User",
//           message: "User not found in system",
//           details: `No user found with ${
//             emp_id ? "emp_id: " + emp_id : "email: " + emp_email
//           }`,
//         });
//       }

//       const user = result[0];

//       if (user.flag !== "Active") {
//         return res.status(401).json({
//           result: "Invalid User",
//           message: "User account is not active",
//           details: `Account status: ${user.flag}`,
//         });
//       }

//       // REMOVED RBAC / DEPARTMENT / HRMS from login
//       // ✔ Login should only authenticate user

//       return processPilotUserLogin(user, res);

//     } catch (error) {
//       console.error("Database error:", error);

//       return res.status(500).json({
//         status: "failed",
//         message: error.message,
//       });
//     }

//   } else {
//     Login(req, res);
//   }
// };
// Helper: Process Pilot User Login
const processPilotUserLogin = async (userRecord, res) => {
  try {
    const empId = userRecord.emp_id;
    const userid = `${userRecord.u_id}_${empId}`;

    const payload = {
      emp_id: empId,
      userid,
    };

    const accessToken = generateAccessToken(payload);
    const refreshToken = generateRefreshToken(payload);

    res.cookie(process.env.COOKIE_NAME, refreshToken, {
      httpOnly: true,
      secure: false,
      sameSite: "none",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    const rbacData = userRecord.rbacDetails;

    const rbacArray = Array.isArray(rbacData)
      ? rbacData
      : Array.isArray(rbacData?.associations)
      ? rbacData.associations
      : [];

    const appName = process.env.RBAC_APPLICATION_NAME;

    const pilotRoles = rbacArray.filter(
      (role) =>
        role.application_name === appName &&
        role.is_active === true
    );

    const [empRows] = await pool.promise().query(
      `SELECT emp_id, emp_name FROM master.emp WHERE emp_id = ?`,
      [empId]
    );

    if (empRows.length === 0) {
      return res.status(401).json({
        status: "failed",
        message: "User not found",
      });
    }

    const roleResults =
      pilotRoles.length > 0
        ? pilotRoles.map((role) => ({
            ...empRows[0],
            designation: role.role_name,
            role_id: role.role_id,
            association_id: role.association_id,
          }))
        : [
            {
              ...empRows[0],
              designation: "User",
            },
          ];

    return res.status(200).json({
      status: "success",
      userid,
      accessToken,
      isGroupHead: false,
      result: roleResults,
      rbacDetails: rbacData,
      source: "master_emp",
      message: "Token login successful",
    });
  } catch (error) {
    console.error("❌ processPilotUserLogin Error:", error);

    return res.status(500).json({
      status: "failed",
      message: error.message,
    });
  }
};

const refreshToken = (req, res) => {
  try {
    const token = req.cookies[process.env.COOKIE_NAME];

    if (!token) {
      return res.status(401).json({ message: "Not authenticated" });
    }

    const user = verifyRefreshToken(token);

    const newAccessToken = generateAccessToken({
      emp_id: user.emp_id,
      userid: user.userid,
    });

    return res.json({ accessToken: newAccessToken });
  } catch (err) {
    return res.status(403).json({ message: "Invalid refresh token" });
  }
};

const logout = (req, res) => {
  res.clearCookie(process.env.COOKIE_NAME);
  infoLog("POST /api/auth/logout - success");
  return res.status(200).json({ message: "Logged out" });
};





module.exports = { login, refreshToken, logout };