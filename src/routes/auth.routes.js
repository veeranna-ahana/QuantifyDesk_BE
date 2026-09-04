const express = require('express');
const router  = express.Router();

const { authMiddleware, adminOnly } = require('../middleware/auth.middleware');
const { login }           = require('../controller/auth.controller');

// Public
router.post('/login',    login);

// Admin only — only admins can create new user accounts
// router.post('/register', authMiddleware, adminOnly, register);
/**
 * @swagger
 * /auth/login:
 *   post:
 *     summary: User Login
 *     description: |
 *       Authenticates a user using  **Authorization Bearer Token**.
 *       
 *       ### Authentication Methods:
 *       **Token-based** - Requires `Authorization: Bearer <token>` (no password needed)
 *       
 *       ### Features:
 *       - RBAC role fetching from external API
 *       - Department association retrieval
 *       - Service Delivery employee list for CR operations
 *       - JWT access token generation
 *       
 *       ### Important Notes:
 *       - User must have `flag = 'Active'` to login
 *       - Require `emp_id` in request body
 *       -  Authorization token is required
 *       - RBAC_API_URL must be configured in `.env`
 *
 *     tags:
 *       - Auth
 *
 *     security:
 *       - bearerAuth: []
 *
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 description: Employee email (required if emp_id not provided)
 *                 example: john.doe@company.com
 *               password:
 *                 type: string
 *                 format: password
 *                 description: Employee password (required if no Bearer token)
 *                 example: SecurePass123!
 *               emp_id:
 *                 type: string
 *                 description: Employee ID (alternative to email)
 *                 example: AS000
 *           examples:
 *             empIdLogin:
 *               summary: Login with Employee ID
 *               value:
 *                 emp_id: AS000
 *             passwordLogin:
 *               summary: Login with Email & Password
 *               value:
 *                 email: john.doe@company.com
 *                 password: SecurePass123!
 *             tokenLogin:
 *               summary: Login with Bearer Token (no password)
 *               value:
 *                 email: john.doe@company.com
 *
 *     responses:
 *       200:
 *         description: Login successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   enum: [success, error]
 *                   example: success
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: Login successful
 *                 userid:
 *                   type: string
 *                   description: Combined user ID (u_id_emp_id)
 *                   example: 123_EMP001
 *                 accessToken:
 *                   type: string
 *                   description: JWT access token
 *                   example: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
 *                 result:
 *                   type: array
 *                   description: User role details
 *                   items:
 *                     type: object
 *                     properties:
 *                       emp_id:
 *                         type: string
 *                         example: EMP001
 *                       emp_name:
 *                         type: string
 *                         example: John Doe
 *                       emp_email:
 *                         type: string
 *                         format: email
 *                         example: john.doe@company.com
 *                       role:
 *                         type: string
 *                         description: Normalized role name
 *                         example: Superadmin
 *                       designation:
 *                         type: string
 *                         description: Original role name from RBAC
 *                         example: SUPERADMIN
 *                       role_id:
 *                         type: integer
 *                         nullable: true
 *                         example: 101
 *                       association_id:
 *                         type: integer
 *                         nullable: true
 *                         example: 5001
 *                       status:
 *                         type: integer
 *                         example: 1
 *                       departments:
 *                         type: array
 *                         items:
 *                           type: object
 *                           properties:
 *                             employee_id:
 *                               type: string
 *                               example: EMP001
 *                             emp_name:
 *                               type: string
 *                               example: John Doe
 *                             department_id:
 *                               type: string
 *                               example: DEPT001
 *                             department_name:
 *                               type: string
 *                               example: Engineering
 *                 departments:
 *                   type: array
 *                   description: User's department associations
 *                   items:
 *                     type: object
 *                     properties:
 *                       employee_id:
 *                         type: string
 *                         example: EMP001
 *                       emp_name:
 *                         type: string
 *                         example: John Doe
 *                       department_id:
 *                         type: string
 *                         example: DEPT001
 *                       department_name:
 *                         type: string
 *                         example: Engineering
 *                 serviceDeliveryEmployees:
 *                   type: array
 *                   description: All Service Delivery employees (for CR operations)
 *                   items:
 *                     type: object
 *                     properties:
 *                       employee_id:
 *                         type: string
 *                         example: EMP002
 *                       emp_name:
 *                         type: string
 *                         example: Jane Smith
 *                       emp_email:
 *                         type: string
 *                         format: email
 *                         example: jane.smith@company.com
 *                       department_id:
 *                         type: string
 *                         example: DEPT002
 *                       department_name:
 *                         type: string
 *                         example: Service Delivery
 *                 source:
 *                   type: string
 *                   enum: [rbac, default]
 *                   description: Source of role data
 *                   example: rbac
 *             examples:
 *               rbacLogin:
 *                 summary: RBAC Login Success
 *                 value:
 *                   status: success
 *                   success: true
 *                   message: Login successful
 *                   userid: 123_EMP001
 *                   accessToken: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
 *                   result:
 *                     - emp_id: EMP001
 *                       emp_name: John Doe
 *                       emp_email: john.doe@company.com
 *                       role: Superadmin
 *                       designation: SUPERADMIN
 *                       role_id: 101
 *                       association_id: 5001
 *                       status: 1
 *                       departments:
 *                         - employee_id: EMP001
 *                           emp_name: John Doe
 *                           department_id: DEPT001
 *                           department_name: Engineering
 *                   departments:
 *                     - employee_id: EMP001
 *                       emp_name: John Doe
 *                       department_id: DEPT001
 *                       department_name: Engineering
 *                   serviceDeliveryEmployees:
 *                     - employee_id: EMP002
 *                       emp_name: Jane Smith
 *                       emp_email: jane.smith@company.com
 *                       department_id: DEPT002
 *                       department_name: Service Delivery
 *                   source: rbac
 *
 *       400:
 *         description: Bad Request - Missing required fields
 *         content:
 *           application/json:
 *             examples:
 *               missingCredentials:
 *                 value:
 *                   status: error
 *                   success: false
 *                   message: Either password or Authorization token is required
 *               missingIdentifier:
 *                 value:
 *                   status: error
 *                   success: false
 *                   message: Either email or emp_id is required
 *
 *       401:
 *         description: Unauthorized - Authentication failed
 *         content:
 *           application/json:
 *             examples:
 *               userNotFound:
 *                 value:
 *                   status: error
 *                   success: false
 *                   message: User not found
 *               inactiveUser:
 *                 value:
 *                   status: error
 *                   success: false
 *                   message: User is not active
 *               invalidPassword:
 *                 value:
 *                   status: error
 *                   success: false
 *                   message: Invalid password
 *
 *       500:
 *         description: Internal Server Error
 *         content:
 *           application/json:
 *             example:
 *               status: error
 *               success: false
 *               message: Login failed
 *               result: null
 */
module.exports = router;
