const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const https = require("https");
const { query, masterQuery } = require("../config/db");
const { pool } = require("../../helpers/dbConfig/connect");
const { infoLog, errorLog } = require("../../middleware/logger");
const axios = require("axios");
const {
  generateAccessToken,
} = require("../../helpers/helperFunctions/authHelper");
const { setUatToken, clearUatToken } = require("../../helpers/pmsTokenStore");

const SALT_ROUNDS = 10;

const readClaim = (payload, path) =>
  path?.split(".").reduce((value, key) => value?.[key], payload);

const getPortalEmployeeId = (payload) => {
  const claimPaths = [
    process.env.MYAHANA_EMPLOYEE_ID_CLAIM,
    "emp_id",
    "employee_id",
    "employeeId",
  ].filter(Boolean);

  for (const path of claimPaths) {
    const value = readClaim(payload, path);
    if (typeof value === "string" || typeof value === "number") {
      return String(value);
    }
  }
  return null;
};

// Express route handler - receives (req, res)
const login = async (req, res) => {
  const { email, password, emp_id } = req.body;
  const authToken = req.headers.authorization?.replace("Bearer ", "");

  // console.log("Login endpoint called with:", {
  //   email,
  //   password: password ? "***" : "none",
  //   emp_id,
  //   authToken: authToken ? "present" : "missing",
  // });

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

    // SECURITY: the Authorization token on this endpoint must be the MyAhana PORTAL token.
    // A token that verifies against OUR OWN signing secret is Quantify's own access JWT (the
    // one the frontend stores after login) — never a portal token. Accepting it would send it
    // to RBAC/PMS (which reject it with 401) and cache it as the user's PMS token.
    if (authToken) {
      let isOwnJwt = false;
      try {
        jwt.verify(authToken, process.env.JWT_ACCESS_SECRET);
        isOwnJwt = true;
      } catch {
        // not ours — expected for a real portal token
      }
      if (isOwnJwt) {
        console.warn(
          `⚠️ Login rejected for emp_id=${user.emp_id}: Quantify's own JWT was sent as the portal token`,
        );
        return res.status(401).json({
          status: "error",
          success: false,
          code: "PORTAL_TOKEN_REQUIRED",
          message: "Please log in through the MyAhana portal.",
        });
      }
    }

    const portalClaims = authToken ? jwt.decode(authToken) : null;
    const portalExpiry =
      portalClaims && typeof portalClaims.exp === "number"
        ? portalClaims.exp
        : null;

    if (authToken && (!portalExpiry || portalExpiry <= Date.now() / 1000)) {
      return res.status(401).json({
        status: "error",
        success: false,
        code: "PORTAL_TOKEN_INVALID",
        message: "Your MyAhana session is invalid or has expired.",
      });
    }

    if (authToken && portalClaims) {
      const expectedIssuer = process.env.MYAHANA_TOKEN_ISSUER;
      const expectedAudiences = (process.env.MYAHANA_TOKEN_AUDIENCE || "")
        .split(",")
        .map((audience) => audience.trim())
        .filter(Boolean);
      const actualAudiences = Array.isArray(portalClaims.aud)
        ? portalClaims.aud
        : [portalClaims.aud];

      if (
        (expectedIssuer && portalClaims.iss !== expectedIssuer) ||
        (expectedAudiences.length &&
          !expectedAudiences.some((audience) =>
            actualAudiences.includes(audience),
          ))
      ) {
        return res.status(401).json({
          status: "error",
          success: false,
          code: "PORTAL_TOKEN_INVALID",
          message: "The portal token is not valid for this application.",
        });
      }
    }

    const portalEmployeeId = getPortalEmployeeId(portalClaims);
    if (portalEmployeeId && portalEmployeeId !== String(user.emp_id)) {
      return res.status(401).json({
        status: "error",
        success: false,
        code: "PORTAL_IDENTITY_MISMATCH",
        message: "The portal token does not match the requested employee.",
      });
    }
    // TODO: Confirm the production employee-ID claim if it is not emp_id,
    // employee_id, or employeeId; set MYAHANA_EMPLOYEE_ID_CLAIM accordingly.

    // Fetch RBC/RBAC details (with or without authToken)
    // tokenVerified = the portal itself (RBAC API) accepted this token. A password-less login
    // is only allowed when this is true — the token must never be trusted on its own.
    let tokenVerified = false;
    let rbacAuthFailed = false; // portal explicitly rejected the token (401/403)
    let rbacData = null;
    let departmentData = [];
    let serviceDeliveryEmployees = []; // For CR: Store Service Delivery employees

    const baseURL = process.env.RBAC_API_URL;

    if (baseURL) {
      try {
        const headers = authToken
          ? { Authorization: `Bearer ${authToken}` }
          : {};

        const instance = axios.create({
          baseURL,
          httpsAgent: new https.Agent({ rejectUnauthorized: true }),
          timeout: 8000,
          headers,
        });

        // Fetch RBAC roles (works with or without token)
        try {
          const rbacResponse = await instance.get(
            "/employee_role_associate/get-current-employees-role-details",
          );
          rbacData = rbacResponse.data;
          tokenVerified = !!authToken;
          // console.log("🔐 Fetched RBAC data successfully");
        } catch (rbacError) {
          console.warn("⚠️ RBAC fetch failed (attempt 1):", rbacError.message);
          const rbacStatus = rbacError.response?.status;
          rbacAuthFailed =
            !!authToken && (rbacStatus === 401 || rbacStatus === 403);

          // Fallback: Try with emp_id parameter
          if (emp_id) {
            try {
              // console.log("📍 Trying RBAC with emp_id parameter:", emp_id);
              const fallbackResponse = await instance.get(
                "/employee_role_associate/get-current-employees-role-details",
                { params: { employee_id: emp_id } },
              );
              rbacData = fallbackResponse.data;
              // console.log("✅ Fetched RBAC data via emp_id fallback");
            } catch (fallbackError) {
              console.warn(
                "⚠️ RBAC fallback also failed:",
                fallbackError.message,
              );
              rbacData = null;
            }
          }
        }

        // SECURITY: no password => the portal token IS the credential. Only the first RBAC call
        // (made WITH the token) counts as proof; the emp_id-only fallback above proves nothing.
        // Fail closed: invalid token => 401, portal unreachable => 503. Never fall through to a
        // default-role login.
        if (!password && !tokenVerified) {
          console.warn(
            `⚠️ Password-less login refused for emp_id=${user.emp_id} from ${req.ip}: ${
              rbacAuthFailed
                ? "portal rejected the token"
                : "token could not be verified"
            }`,
          );
          if (rbacAuthFailed) {
            return res.status(401).json({
              status: "error",
              success: false,
              code: "PORTAL_TOKEN_INVALID",
              message:
                "Your MyAhana session is invalid or has expired. Please log in again through MyAhana.",
            });
          }
          return res.status(503).json({
            status: "error",
            success: false,
            code: "PORTAL_UNREACHABLE",
            message:
              "Could not verify your MyAhana session right now. Please try again.",
          });
        }

        // Fetch departments (only with authToken)
        if (authToken) {
          let departments = [];
          try {
            const deptListResponse = await instance.get(
              "/department_admin/get-departments",
            );
            departments = deptListResponse.data?.departments || [];
            // console.log("📦 Fetched departments:", departments);
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
              instance
                .get(
                  "/employee_department_association/get-employees-by-department-id",
                  { params: { department_id: dept.department_id } },
                )
                .catch((e) => ({ status: "rejected", reason: e })),
            );
            deptEmployeeResponses = await Promise.allSettled(deptPromises);
          }

          deptEmployeeResponses.forEach((res, index) => {
            if (res.status === "fulfilled" && res.value?.data) {
              const employees = res.value.data?.data || [];
              // console.log(
              //   "Current Department:",
              //   departments[index].department_name,
              // );
              // New code for CR
              if (departments[index].department_name === "Service Delivery") {
                // console.log(
                //   "Service Delivery Employees:",
                //   employees.map((emp) => emp.emp_name),
                // );

                serviceDeliveryEmployees = employees;
              }
              // Store all employees for CR (without affecting existing logic)
              allDepartmentEmployees.push({
                department_id: departments[index].department_id,
                department_name: departments[index].department_name,
                employees,
              });
              // console.log(
              //   `Department ${departments[index].department_name} (${departments[index].department_id}) has ${employees.length} employees`,
              // );

              // console.log("Employee List:", employees);
              const match = employees.find(
                (emp) => emp.employee_id === user.emp_id,
              );
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
          // console.log(
          //   "All Department Employees:",
          //   JSON.stringify(allDepartmentEmployees, null, 2),
          // );

          // Remove duplicate departments
          departmentData = Array.from(
            new Map(departmentData.map((d) => [d.department_id, d])).values(),
          );
          // console.log("🏢 Processed departments:", departmentData.length);
        }
      } catch (err) {
        console.error("❌ RBC/RBAC fetch error:", err.message);
        rbacData = null;
        departmentData = [];
      }
    } else {
      console.warn("⚠️ RBAC_API_URL not configured in .env");
      if (!password) {
        // Cannot verify a token-only login without the portal — refuse rather than trust it.
        return res.status(503).json({
          status: "error",
          success: false,
          code: "PORTAL_UNREACHABLE",
          message:
            "Could not verify your MyAhana session right now. Please try again.",
        });
      }
    }

    // Process login result
    const loginResult = processUserLoginWithRBAC(
      user,
      rbacData,
      departmentData,
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

    const accessTtlSeconds = authToken
      ? Math.min(8 * 60 * 60, portalExpiry - Math.floor(Date.now() / 1000))
      : undefined;
    if (authToken && accessTtlSeconds <= 0) {
      return res.status(401).json({
        status: "error",
        success: false,
        code: "PORTAL_TOKEN_INVALID",
        message: "Your MyAhana session has expired.",
      });
    }
    const accessToken = generateAccessToken(tokenPayload, accessTtlSeconds);

    // ── Cache the UAT token server-side for PMS calls ──────────────────
    // Our own accessToken above is what the frontend uses from now on for
    // every request to this backend. But PMS only accepts the ORIGINAL
    // UAT-issued token (authToken, from the request header at the top of
    // this function) — not our JWT. Since the frontend overwrites its
    // stored token with our accessToken right after login, we cache the
    // UAT token here, keyed by emp_id, so any controller calling PMS later
    // can look it up via req.user.emp_id instead of relying on the
    // frontend to carry and re-attach it. See src/helpers/pmsTokenStore.js.
    if (authToken && tokenVerified) {
      try {
        // Decode only — we don't hold UAT's signing secret, so we can't
        // (and don't need to) verify it here; PMS will do its own
        // verification when we forward it.
        setUatToken(empIdForLookup, authToken, portalExpiry * 1000);
      } catch (e) {
        console.warn("⚠️ Could not cache UAT token for PMS use:", e.message);
      }
    }

    // console.log(
    //   "✅ Login successful for:",
    //   user.emp_email,
    //   "| Emp ID:",
    //   empIdForLookup,
    // );

    return res.status(200).json({
      status: "success",
      success: true,
      message: "Login successful",
      userid: loginResult.userid,
      // id: localUserId, // ❌ Removed - no users table dependency
      accessToken, // ✅ Quantify JWT — for Quantify's own APIs
      accessTokenExpiresAt: jwt.decode(accessToken)?.exp || null,
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

  // console.log("🎯 Processing login with RBAC data:", {
  //   emp_id,
  //   rbacDataType: typeof rbacData,
  //   rbacDataIsArray: Array.isArray(rbacData),
  //   rbacDataKeys: rbacData ? Object.keys(rbacData).slice(0, 5) : "null",
  // });

  const rbacArray = Array.isArray(rbacData)
    ? rbacData
    : Array.isArray(rbacData?.associations)
      ? rbacData.associations
      : Array.isArray(rbacData?.data)
        ? rbacData.data
        : [];

  const appName = process.env.RBAC_APPLICATION_NAME || "QuantifyTool";

  // Log all fetched roles for debugging
  // console.log("📊 RBAC Data Fetched:", {
  //   totalRoles: rbacArray.length,
  //   appNameLooking: appName,
  //   allApplications: rbacArray
  //     .map((r) => r.application_name)
  //     .filter((v, i, a) => a.indexOf(v) === i),
  // });

  if (rbacArray.length > 0) {
    // console.log(
    //   "📋 Sample roles from RBAC:",
    //   rbacArray.slice(0, 3).map((r) => ({
    //     role_name: r.role_name,
    //     application_name: r.application_name,
    //     is_active: r.is_active,
    //   })),
    // );
  }

  const roles = rbacArray.filter(
    (role) => role.application_name === appName && role.is_active === true,
  );

  // console.log("✔️ Filtered roles for", appName + ":", roles.length);

  const departments = (departmentData || []).map((dept) => ({
    employee_id: dept.employee_id,
    emp_name: dept.emp_name,
    department_id: dept.department_id,
    department_name: dept.department_name,
  }));

  if (roles.length > 0) {
    const rolesArray = roles.map((role) => {
      // Normalize role name: capitalize first letter
      const normalizedRole =
        role.role_name.charAt(0).toUpperCase() +
        role.role_name.slice(1).toLowerCase();

      // console.log(
      //   `✅ USER: ${userRecord.emp_name} → ROLE: "${normalizedRole}" (from RBAC: "${role.role_name}")`,
      // );

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
  console.warn(
    `⚠️ USER: ${userRecord.emp_name} → NO ${appName} ROLE. Using default: Employee`,
  );
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

const logout = (req, res) => {
  const authToken = req.headers.authorization?.replace(/^Bearer\s+/, "");
  if (authToken) {
    try {
      const user = jwt.verify(
        authToken,
        process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET || "dev_secret",
        { ignoreExpiration: true },
      );
      if (user.emp_id) clearUatToken(user.emp_id);
    } catch {
      // Logout still clears the browser's legacy refresh cookie when the token is invalid.
    }
  }
  const legacyCookieOptions = { path: "/" };
  if (process.env.COOKIE_DOMAIN) {
    legacyCookieOptions.domain = process.env.COOKIE_DOMAIN;
  }
  res.clearCookie(
    process.env.COOKIE_NAME || "refreshToken",
    legacyCookieOptions,
  );
  infoLog("POST /api/auth/logout - success");
  return res.status(200).json({ message: "Logged out" });
};

module.exports = { login, logout };
