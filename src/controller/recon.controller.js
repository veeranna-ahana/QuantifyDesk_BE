const { query, masterQuery } = require("../config/db");
const XLSX = require("xlsx");

// ──────────────────────────────────────────────────────────────
// 1. GET FILTER OPTIONS (UPDATED - Uses master.emp)
// ──────────────────────────────────────────────────────────────
const getReconFilters = async (req, res, next) => {
    try {
        // ─── Get clients from projects table ──────────────────────
        const projectClients = await query(`
            SELECT DISTINCT client_name 
            FROM projects 
            WHERE client_name IS NOT NULL AND client_name != ''
        `);
        
        // ─── Get clients from timesheet_entries ────────────────────
        const timesheetClients = await query(`
            SELECT DISTINCT original_client_name as client_name
            FROM timesheet_entries 
            WHERE original_client_name IS NOT NULL AND original_client_name != ''
        `);
        
        // ─── Combine and deduplicate ──────────────────────────────
        const allClients = [
            ...projectClients.map(c => c.client_name),
            ...timesheetClients.map(c => c.client_name)
        ];
        const uniqueClients = [...new Set(allClients)].filter(Boolean);
        
        // ─── Get projects ──────────────────────────────────────────
        const projects = await query(`
            SELECT id, project_code, project_name 
            FROM projects 
            WHERE project_code IS NOT NULL
        `);
        
        // ─── Get employees from master.emp ─────────────────────────
        const employees = await masterQuery(`
            SELECT u_id as id, emp_id, emp_name as name 
            FROM emp 
            WHERE flag = 'Active' 
            AND emp_id IS NOT NULL
            ORDER BY emp_name
        `);
        
        // ─── Get departments ───────────────────────────────────────
        const departments = await query(`
            SELECT DISTINCT 'Application Development and Automation' as dept
        `);
        
        // ─── Get managers from projects ──────────────────────────
        const managers = await query(`
            SELECT DISTINCT project_manager as manager_name
            FROM projects
            WHERE project_manager IS NOT NULL AND project_manager != ''
        `);
        
        res.status(200).json({
            clients: uniqueClients,
            projects: projects.map(p => ({
                id: p.id,
                code: p.project_code,
                name: p.project_name
            })),
            employees: employees.map(e => ({
                id: e.id,
                emp_id: e.emp_id,
                name: e.name
            })),
            departments: departments.map(d => d.dept).filter(Boolean),
            managers: managers.map(m => m.manager_name).filter(Boolean)
        });
        
    } catch (err) {
        console.error("Get filters error:", err);
        res.status(500).json({ message: err.message });
    }
};

// ──────────────────────────────────────────────────────────────
// 2. GET DASHBOARD SUMMARY (UPDATED - Uses master.emp)
// ──────────────────────────────────────────────────────────────
const getReconDashboard = async (req, res, next) => {
    try {
        // ─── Get ALL unique projects from timesheet_entries ──────────
        const timesheetProjectsQuery = `
            SELECT 
                te.original_project_code,
                MAX(te.original_project_name) as original_project_name,
                MAX(te.original_sub_category) as original_sub_category,
                MAX(CASE WHEN p.id IS NOT NULL THEN 1 ELSE 0 END) as in_system,
                MAX(CASE WHEN ee.id IS NOT NULL THEN 1 ELSE 0 END) as has_estimate,
                COALESCE(SUM(te.hours), 0) as actual_hours
            FROM timesheet_entries te
            LEFT JOIN projects p ON p.project_code = te.original_project_code AND p.sub_category = te.original_sub_category
            LEFT JOIN effort_estimates ee ON ee.project_id = p.id
            GROUP BY te.original_project_code, te.original_sub_category
            HAVING COALESCE(SUM(te.hours), 0) > 0
        `;
        const timesheetProjects = await query(timesheetProjectsQuery, []);
        
        // ─── Get ALL projects from projects table with subcategory ──
        const systemProjectsQuery = `
            SELECT 
                p.id, 
                p.project_code, 
                p.project_name,
                p.sub_category,
                CASE WHEN ee.id IS NOT NULL THEN 1 ELSE 0 END as has_estimate
            FROM projects p
            LEFT JOIN effort_estimates ee ON ee.project_id = p.id
        `;
        const systemProjects = await query(systemProjectsQuery, []);
        
        // ─── Get estimated hours for projects ──────────────────────
        const estimatedData = await query(`
            SELECT 
                p.project_code,
                p.sub_category,
                COALESCE(SUM(ee.total_hrs), 0) as estimated_hours
            FROM projects p
            LEFT JOIN effort_estimates ee ON ee.project_id = p.id
            GROUP BY p.project_code, p.sub_category
        `);
        
        const estimatedMap = new Map();
        estimatedData.forEach(e => {
            const key = `${e.project_code}||${e.sub_category || 'No Subcategory'}`;
            estimatedMap.set(key, parseFloat(e.estimated_hours || 0));
        });
        
        // ─── Combine projects from both sources using subcategory as key ──
        const combinedProjects = new Map();
        const projectCodesWithTimesheets = new Set();
        
        // Add system projects
        systemProjects.forEach(p => {
            const key = `${p.project_code}||${p.sub_category || 'No Subcategory'}`;
            const estimated = estimatedMap.get(key) || 0;
            
            combinedProjects.set(key, {
                project_code: p.project_code,
                project_name: p.project_name,
                sub_category: p.sub_category || 'No Subcategory',
                in_system: true,
                has_estimate: p.has_estimate === 1,
                actual_hours: 0,
                estimated_hours: estimated,
                from_timesheet: false
            });
        });
        
        // Add timesheet projects
        timesheetProjects.forEach(p => {
            const key = `${p.original_project_code}||${p.original_sub_category || 'No Subcategory'}`;
            projectCodesWithTimesheets.add(key);
            
            if (combinedProjects.has(key)) {
                const existing = combinedProjects.get(key);
                existing.actual_hours = parseFloat(p.actual_hours || 0);
                existing.from_timesheet = true;
                // Update has_estimate if timesheet project has estimate
                if (p.has_estimate === 1) {
                    existing.has_estimate = true;
                }
                combinedProjects.set(key, existing);
            } else {
                combinedProjects.set(key, {
                    project_code: p.original_project_code,
                    project_name: p.original_project_name || p.original_project_code,
                    sub_category: p.original_sub_category || 'No Subcategory',
                    in_system: false,
                    has_estimate: false,
                    actual_hours: parseFloat(p.actual_hours || 0),
                    estimated_hours: 0,
                    from_timesheet: true
                });
            }
        });
        
        // ─── Also add system projects that don't have timesheets ──
        systemProjects.forEach(p => {
            const key = `${p.project_code}||${p.sub_category || 'No Subcategory'}`;
            if (!combinedProjects.has(key)) {
                const estimated = estimatedMap.get(key) || 0;
                combinedProjects.set(key, {
                    project_code: p.project_code,
                    project_name: p.project_name,
                    sub_category: p.sub_category || 'No Subcategory',
                    in_system: true,
                    has_estimate: p.has_estimate === 1,
                    actual_hours: 0,
                    estimated_hours: estimated,
                    from_timesheet: false
                });
            }
        });
        
        // ─── Calculate metrics ──────────────────────────────────────
        const allProjects = Array.from(combinedProjects.values());
        const totalProjects = allProjects.length;
        
        let projectsWithEstimates = 0;
        let projectsWithoutEstimates = 0;
        let projectsWithTimesheets = 0;
        let projectsWithoutTimesheets = 0;
        
        allProjects.forEach(p => {
            if (p.has_estimate && p.estimated_hours > 0) {
                projectsWithEstimates++;
            } else {
                projectsWithoutEstimates++;
            }
            
            if (p.actual_hours > 0) {
                projectsWithTimesheets++;
            } else {
                projectsWithoutTimesheets++;
            }
        });
        
        // ─── Calculate total actual hours from timesheet_entries directly ──
        const totalActualResult = await query(`
            SELECT COALESCE(SUM(hours), 0) as total_hours
            FROM timesheet_entries
        `);
        const totalActualHours = parseFloat(totalActualResult[0]?.total_hours || 0);
        
        // ─── Get total estimated hours from effort_estimates ────
        const estimatedResult = await query(`SELECT COALESCE(SUM(total_hrs), 0) as total FROM effort_estimates`, []);
        const totalEstimatedFromTable = parseFloat(estimatedResult[0]?.total || 0);
        
        // ─── Calculate over/under utilized ──────────────────────────
        let overutilized = 0;
        let underutilized = 0;
        
        const projectWithEstimates = allProjects.filter(p => p.has_estimate && p.estimated_hours > 0);
        
        for (const p of projectWithEstimates) {
            // Get actual hours from timesheet_entries for this specific project-subcategory combination
            const actualResult = await query(`
                SELECT COALESCE(SUM(te.hours), 0) as actual_hours
                FROM timesheet_entries te
                WHERE te.original_project_code = ?
                AND (te.original_sub_category = ? OR (te.original_sub_category IS NULL AND ? IS NULL))
            `, [p.project_code, p.sub_category === 'No Subcategory' ? null : p.sub_category, p.sub_category === 'No Subcategory' ? null : p.sub_category]);
            
            const actualHrs = parseFloat(actualResult[0]?.actual_hours || 0);
            const utilPct = p.estimated_hours > 0 ? (actualHrs / p.estimated_hours) * 100 : 0;
            
            if (utilPct > 100) {
                overutilized++;
            } else if (utilPct < 100 && utilPct > 0) {
                underutilized++;
            }
        }
        
        // ─── Get total employees from master.emp via timesheet_entries ──
        const employeesResult = await query(`
            SELECT COUNT(DISTINCT te.emp_id) as count 
            FROM timesheet_entries te
            WHERE te.emp_id IS NOT NULL
        `);
        const totalEmployees = parseInt(employeesResult[0]?.count || 0);
        
        res.status(200).json({
            total_projects: totalProjects,
            projects_with_estimates: projectsWithEstimates,
            projects_without_estimates: projectsWithoutEstimates,
            projects_with_timesheets: projectsWithTimesheets,
            projects_without_timesheets: projectsWithoutTimesheets,
            total_employees: totalEmployees,
            total_estimated_hours: totalEstimatedFromTable,
            total_actual_hours: totalActualHours,
            total_variance_hours: totalEstimatedFromTable - totalActualHours,
            overutilized_count: overutilized,
            underutilized_count: underutilized
        });
        
    } catch (err) {
        console.error("Dashboard error:", err);
        res.status(500).json({ message: err.message });
    }
};

// ──────────────────────────────────────────────────────────────
// 3. GET PROJECT LEVEL RECONCILIATION (UPDATED - Uses master.emp)
// ──────────────────────────────────────────────────────────────
const getProjectLevelRecon = async (req, res, next) => {
    try {
        const { month, year, clientName, projectCode, projectName, employeeName, department, reportingManager } = req.query;
        
        console.log('📊 Project Level Recon Filters:', { month, year, clientName, projectCode, projectName, employeeName, department, reportingManager });
        
        // ─── Build date conditions ──────────────────────────────────
        let dateConditions = [];
        let dateParams = [];
        
        if (month && year) {
            dateConditions.push('YEAR(te.entry_date) = ? AND MONTH(te.entry_date) = ?');
            dateParams.push(parseInt(year), parseInt(month));
        } else if (month) {
            dateConditions.push('MONTH(te.entry_date) = ?');
            dateParams.push(parseInt(month));
        } else if (year) {
            dateConditions.push('YEAR(te.entry_date) = ?');
            dateParams.push(parseInt(year));
        }
        
        const dateWhereClause = dateConditions.length > 0 
            ? `AND ${dateConditions.join(' AND ')}` 
            : '';

        // ─── Get System Projects with subcategory as unique key ────
        let systemWhere = [];
        let systemParams = [];
        
        if (clientName) {
            systemWhere.push('p.client_name LIKE ?');
            systemParams.push(`%${clientName}%`);
        }
        if (projectCode) {
            systemWhere.push('p.project_code LIKE ?');
            systemParams.push(`%${projectCode}%`);
        }
        if (projectName) {
            systemWhere.push('p.project_name LIKE ?');
            systemParams.push(`%${projectName}%`);
        }
        if (department) {
            systemWhere.push('p.sub_category LIKE ?');
            systemParams.push(`%${department}%`);
        }
        if (reportingManager) {
            systemWhere.push('p.project_manager LIKE ?');
            systemParams.push(`%${reportingManager}%`);
        }
        
        const systemWhereClause = systemWhere.length > 0 
            ? `AND ${systemWhere.join(' AND ')}` 
            : '';

        // ✅ CHANGED: Use sub_category as the unique identifier
        let systemProjects = [];
        
        if (dateConditions.length > 0) {
            systemProjects = await query(`
                SELECT DISTINCT
                    p.id as project_id,
                    p.project_code,
                    p.project_name,
                    p.client_name,
                    p.sub_category,
                    COALESCE((SELECT SUM(total_hrs) FROM effort_estimates WHERE project_id = p.id), 0) as estimated_hours,
                    1 as in_system,
                    CASE WHEN EXISTS (SELECT 1 FROM effort_estimates WHERE project_id = p.id) THEN 1 ELSE 0 END as has_estimate
                FROM projects p
                INNER JOIN timesheet_entries te ON te.project_id = p.id
                WHERE 1=1 ${systemWhereClause} ${dateWhereClause}
                GROUP BY p.id, p.project_code, p.project_name, p.client_name, p.sub_category
            `, [...systemParams, ...dateParams]);
        } else {
            systemProjects = await query(`
                SELECT 
                    p.id as project_id,
                    p.project_code,
                    p.project_name,
                    p.client_name,
                    p.sub_category,
                    COALESCE((SELECT SUM(total_hrs) FROM effort_estimates WHERE project_id = p.id), 0) as estimated_hours,
                    1 as in_system,
                    CASE WHEN EXISTS (SELECT 1 FROM effort_estimates WHERE project_id = p.id) THEN 1 ELSE 0 END as has_estimate
                FROM projects p
                WHERE 1=1 ${systemWhereClause}
                GROUP BY p.id, p.project_code, p.project_name, p.client_name, p.sub_category
            `, systemParams);
        }

        // ─── Get timesheet data grouped by subcategory ──────────────
        let timesheetSubquery = `
            SELECT 
                te.project_id,
                p.sub_category,
                COALESCE(SUM(te.hours), 0) as actual_hours,
                COUNT(DISTINCT te.emp_id) as employee_count
            FROM timesheet_entries te
            LEFT JOIN projects p ON te.project_id = p.id
            WHERE te.project_id IS NOT NULL
        `;
        
        let timesheetSubqueryParams = [];
        
        if (month && year) {
            timesheetSubquery += ` AND YEAR(te.entry_date) = ? AND MONTH(te.entry_date) = ?`;
            timesheetSubqueryParams.push(parseInt(year), parseInt(month));
        } else if (month) {
            timesheetSubquery += ` AND MONTH(te.entry_date) = ?`;
            timesheetSubqueryParams.push(parseInt(month));
        } else if (year) {
            timesheetSubquery += ` AND YEAR(te.entry_date) = ?`;
            timesheetSubqueryParams.push(parseInt(year));
        }
        
        if (clientName) {
            timesheetSubquery += ` AND te.original_client_name LIKE ?`;
            timesheetSubqueryParams.push(`%${clientName}%`);
        }
        if (projectCode) {
            timesheetSubquery += ` AND (te.original_project_code LIKE ? OR te.project_id IN (SELECT id FROM projects WHERE project_code LIKE ?))`;
            timesheetSubqueryParams.push(`%${projectCode}%`, `%${projectCode}%`);
        }
        if (projectName) {
            timesheetSubquery += ` AND (te.original_project_name LIKE ? OR te.project_id IN (SELECT id FROM projects WHERE project_name LIKE ?))`;
            timesheetSubqueryParams.push(`%${projectName}%`, `%${projectName}%`);
        }
        if (department) {
            timesheetSubquery += ` AND (p.sub_category LIKE ? OR te.original_project_name LIKE ?)`;
            timesheetSubqueryParams.push(`%${department}%`, `%${department}%`);
        }
        
        timesheetSubquery += ` GROUP BY te.project_id, p.sub_category`;
        
        const timesheetData = await query(timesheetSubquery, timesheetSubqueryParams);
        
        const timesheetMap = {};
        timesheetData.forEach(row => {
            const key = row.sub_category || row.project_id;
            timesheetMap[key] = {
                actual_hours: parseFloat(row.actual_hours || 0),
                employee_count: parseInt(row.employee_count || 0),
                project_id: row.project_id,
                sub_category: row.sub_category
            };
        });

        // ─── Merge timesheet data with system projects ──────────────
        let filteredSystemProjects = systemProjects.map(p => {
            // Use sub_category as the key
            const key = p.sub_category || p.project_code;
            const timesheet = timesheetMap[key] || { actual_hours: 0, employee_count: 0 };
            return {
                ...p,
                actual_hours: timesheet.actual_hours,
                employee_count: timesheet.employee_count,
                unique_key: key
            };
        });

        // ─── Apply employee filter ────────────────────────────────────
        if (employeeName) {
            let empProjectQuery = `
                SELECT DISTINCT te.project_id, p.sub_category
                FROM timesheet_entries te
                LEFT JOIN master.emp e ON te.emp_id = e.emp_id
                LEFT JOIN projects p ON te.project_id = p.id
                WHERE e.emp_name LIKE ?
                AND te.project_id IS NOT NULL
            `;
            let empParams = [`%${employeeName}%`];
            
            if (month && year) {
                empProjectQuery += ` AND YEAR(te.entry_date) = ? AND MONTH(te.entry_date) = ?`;
                empParams.push(parseInt(year), parseInt(month));
            } else if (month) {
                empProjectQuery += ` AND MONTH(te.entry_date) = ?`;
                empParams.push(parseInt(month));
            } else if (year) {
                empProjectQuery += ` AND YEAR(te.entry_date) = ?`;
                empParams.push(parseInt(year));
            }
            
            const empProjectData = await query(empProjectQuery, empParams);
            const empProjectSet = new Set(empProjectData.map(r => r.sub_category || r.project_id));
            
            filteredSystemProjects = filteredSystemProjects.filter(p => {
                return empProjectSet.has(p.sub_category || p.project_id);
            });
        }

        // ─── Get Timesheet Projects (projects not in system) ──────
        let timesheetWhere = [];
        let timesheetParams = [];
        let employeeJoin = '';
        
        if (projectCode) {
            timesheetWhere.push('te.original_project_code LIKE ?');
            timesheetParams.push(`%${projectCode}%`);
        }
        if (projectName) {
            timesheetWhere.push('te.original_project_name LIKE ?');
            timesheetParams.push(`%${projectName}%`);
        }
        if (clientName) {
            timesheetWhere.push('te.original_client_name LIKE ?');
            timesheetParams.push(`%${clientName}%`);
        }
        if (month && year) {
            timesheetWhere.push('YEAR(te.entry_date) = ? AND MONTH(te.entry_date) = ?');
            timesheetParams.push(parseInt(year), parseInt(month));
        } else if (month) {
            timesheetWhere.push('MONTH(te.entry_date) = ?');
            timesheetParams.push(parseInt(month));
        } else if (year) {
            timesheetWhere.push('YEAR(te.entry_date) = ?');
            timesheetParams.push(parseInt(year));
        }
        if (employeeName) {
            employeeJoin = 'LEFT JOIN master.emp e ON te.emp_id = e.emp_id';
            timesheetWhere.push('e.emp_name LIKE ?');
            timesheetParams.push(`%${employeeName}%`);
        }
        if (department) {
            timesheetWhere.push('te.original_project_name LIKE ?');
            timesheetParams.push(`%${department}%`);
        }
        
        const timesheetWhereClause = timesheetWhere.length > 0 
            ? `AND ${timesheetWhere.join(' AND ')}` 
            : '';
        
        // ✅ CHANGED: Group by original_sub_category as unique key
        let timesheetQuery = `
            SELECT 
                te.original_project_code as project_code,
                MAX(te.original_project_name) as project_name,
                MAX(te.original_client_name) as client_name,
                MAX(te.original_sub_category) as sub_category,
                te.original_sub_category as sub_category,
                COALESCE(SUM(te.hours), 0) as actual_hours,
                COUNT(DISTINCT te.emp_id) as employee_count,
                0 as in_system,
                0 as has_estimate,
                NULL as project_id,
                0 as estimated_hours
            FROM timesheet_entries te
            ${employeeJoin}
            WHERE te.project_id IS NULL
            ${timesheetWhereClause}
            GROUP BY te.original_sub_category, te.original_project_code
        `;
        
        const timesheetProjects = await query(timesheetQuery, timesheetParams);

        // ─── Combine results using subcategory as unique key ────────
        const projectMap = new Map();
        
        // Add system projects with subcategory as key
        filteredSystemProjects.forEach(p => {
            const key = p.sub_category || p.project_code;
            projectMap.set(key, p);
        });
        
        // Add timesheet projects with subcategory as key
        timesheetProjects.forEach(p => {
            const key = p.sub_category || p.project_code;
            if (projectMap.has(key)) {
                const existing = projectMap.get(key);
                if (p.actual_hours > 0) {
                    existing.actual_hours = p.actual_hours;
                    existing.employee_count = p.employee_count;
                    // Preserve subcategory from timesheet if system doesn't have it
                    if (!existing.sub_category && p.sub_category) {
                        existing.sub_category = p.sub_category;
                    }
                }
                projectMap.set(key, existing);
            } else {
                if (!p.in_system) {
                    projectMap.set(key, p);
                }
            }
        });

        // ─── Reporting Manager filter ──────────────────────────────
        let allProjects = Array.from(projectMap.values());
        
        if (reportingManager) {
            allProjects = allProjects.filter(p => 
                p.client_name && p.client_name.toLowerCase().includes(reportingManager.toLowerCase())
            );
        }

        // ─── Build response with subcategory as identifier ──────────
        const result = allProjects.map(p => {
            const estimated = parseFloat(p.estimated_hours || 0);
            const actual = parseFloat(p.actual_hours || 0);
            const variance = estimated - actual;
            const variancePct = estimated > 0 ? (variance / estimated) * 100 : 0;
            const utilPct = estimated > 0 ? (actual / estimated) * 100 : 0;

            let status = 'Utilized';

            if (!p.in_system) {
                status = 'Project Not Found';
            } else if (estimated === 0) {
                status = 'No Estimate';
            } else if (utilPct > 100) {
                status = 'Over-utilized';
            } else if (utilPct >= 70) {
                status = 'Utilized';
            } else if (utilPct >= 50) {
                status = 'Moderate';
            } else {
                status = 'Under-utilized';
            }
            
            return {
                project_id: p.project_id,
                project_code: p.project_code || '',
                project_name: p.project_name || p.project_code || '',
                client_name: p.client_name || '—',
                sub_category: p.sub_category || 'No Subcategory', // ✅ Added subcategory
                estimated_hours: estimated.toFixed(1),
                estimated_days: (estimated / 8).toFixed(1),
                actual_hours: actual.toFixed(1),
                actual_days: (actual / 8).toFixed(1),
                variance_hours: variance.toFixed(1),
                variance_pct: variancePct.toFixed(1),
                employee_count: parseInt(p.employee_count || 0),
                in_system: p.in_system === 1,
                has_estimate: p.has_estimate === 1,
                status: status
            };
        });

        // Sort by subcategory
        result.sort((a, b) => {
            const aSub = a?.sub_category || '';
            const bSub = b?.sub_category || '';
            return aSub.localeCompare(bSub);
        });

        res.status(200).json(result);

    } catch (err) {
        console.error("Project level recon error:", err);
        res.status(500).json({ message: err.message });
    }
};

// ──────────────────────────────────────────────────────────────
// 4. GET EMPLOYEE LEVEL RECONCILIATION (UPDATED - Uses master.emp)
// ──────────────────────────────────────────────────────────────
const getEmployeeLevelRecon = async (req, res, next) => {
    try {
        const { month, year, clientName, projectCode, projectName, employeeName, department, reportingManager } = req.query;
        
        console.log('📊 Employee Level Recon Filters:', { month, year, clientName, projectCode, projectName, employeeName, department, reportingManager });
        
        // ─── Build date conditions ──────────────────────────────────
        let dateConditions = [];
        let dateParams = [];
        
        if (month && year) {
            dateConditions.push('YEAR(te.entry_date) = ? AND MONTH(te.entry_date) = ?');
            dateParams.push(parseInt(year), parseInt(month));
        } else if (month) {
            dateConditions.push('MONTH(te.entry_date) = ?');
            dateParams.push(parseInt(month));
        } else if (year) {
            dateConditions.push('YEAR(te.entry_date) = ?');
            dateParams.push(parseInt(year));
        }
        
        const dateWhereClause = dateConditions.length > 0 
            ? `AND ${dateConditions.join(' AND ')}` 
            : '';
        
        // ─── Query 1: Get assignments with subcategory ──────────────
        let assignWhere = [];
        let assignParams = [];
        
        if (clientName) {
            assignWhere.push('p.client_name LIKE ?');
            assignParams.push(`%${clientName}%`);
        }
        if (projectCode) {
            assignWhere.push('p.project_code LIKE ?');
            assignParams.push(`%${projectCode}%`);
        }
        if (projectName) {
            assignWhere.push('p.project_name LIKE ?');
            assignParams.push(`%${projectName}%`);
        }
        if (department) {
            assignWhere.push('p.sub_category LIKE ?');
            assignParams.push(`%${department}%`);
        }
        if (reportingManager) {
            assignWhere.push('p.project_manager LIKE ?');
            assignParams.push(`%${reportingManager}%`);
        }
        if (employeeName) {
            assignWhere.push('e.emp_name LIKE ?');
            assignParams.push(`%${employeeName}%`);
        }
        
        const assignWhereClause = assignWhere.length > 0 
            ? `AND ${assignWhere.join(' AND ')}` 
            : '';
        
        // ─── Get assignments with subcategory ───────────────────────
        let assignmentsData = [];
        
        if (dateConditions.length > 0) {
            assignmentsData = await query(`
                SELECT 
                    a.emp_id,
                    e.emp_name as employee_name,
                    a.project_id,
                    p.project_code,
                    p.project_name,
                    p.client_name,
                    p.sub_category,
                    SUM(a.units_assigned) as assigned_units,
                    SUM(a.estimated_days) as assigned_days,
                    SUM(a.estimated_hours) as assigned_hours,
                    GROUP_CONCAT(DISTINCT a.role) as roles
                FROM assignments a
                LEFT JOIN master.emp e ON a.emp_id = e.emp_id
                LEFT JOIN projects p ON a.project_id = p.id
                INNER JOIN timesheet_entries te ON te.emp_id = a.emp_id AND te.project_id = a.project_id
                WHERE 1=1 ${assignWhereClause} ${dateWhereClause}
                GROUP BY a.emp_id, a.project_id, e.emp_name, p.project_code, p.project_name, p.client_name, p.sub_category
            `, [...assignParams, ...dateParams]);
        } else {
            assignmentsData = await query(`
                SELECT 
                    a.emp_id,
                    e.emp_name as employee_name,
                    a.project_id,
                    p.project_code,
                    p.project_name,
                    p.client_name,
                    p.sub_category,
                    SUM(a.units_assigned) as assigned_units,
                    SUM(a.estimated_days) as assigned_days,
                    SUM(a.estimated_hours) as assigned_hours,
                    GROUP_CONCAT(DISTINCT a.role) as roles
                FROM assignments a
                LEFT JOIN master.emp e ON a.emp_id = e.emp_id
                LEFT JOIN projects p ON a.project_id = p.id
                WHERE 1=1 ${assignWhereClause}
                GROUP BY a.emp_id, a.project_id, e.emp_name, p.project_code, p.project_name, p.client_name, p.sub_category
            `, assignParams);
        }

        // ─── Get timesheet data with subcategory ────────────────────
        let timesheetWhere = [];
        let timesheetParams = [];
        
        if (month && year) {
            timesheetWhere.push('YEAR(te.entry_date) = ? AND MONTH(te.entry_date) = ?');
            timesheetParams.push(parseInt(year), parseInt(month));
        } else if (month) {
            timesheetWhere.push('MONTH(te.entry_date) = ?');
            timesheetParams.push(parseInt(month));
        } else if (year) {
            timesheetWhere.push('YEAR(te.entry_date) = ?');
            timesheetParams.push(parseInt(year));
        }
        if (employeeName) {
            timesheetWhere.push('e.emp_name LIKE ?');
            timesheetParams.push(`%${employeeName}%`);
        }
        if (projectCode) {
            timesheetWhere.push('(p.project_code LIKE ? OR te.original_project_code LIKE ?)');
            timesheetParams.push(`%${projectCode}%`, `%${projectCode}%`);
        }
        if (projectName) {
            timesheetWhere.push('(p.project_name LIKE ? OR te.original_project_name LIKE ?)');
            timesheetParams.push(`%${projectName}%`, `%${projectName}%`);
        }
        if (clientName) {
            timesheetWhere.push('(p.client_name LIKE ? OR te.original_client_name LIKE ?)');
            timesheetParams.push(`%${clientName}%`, `%${clientName}%`);
        }
        if (department) {
            timesheetWhere.push('(p.sub_category LIKE ? OR te.original_sub_category LIKE ? OR te.original_project_name LIKE ?)');
            timesheetParams.push(`%${department}%`, `%${department}%`, `%${department}%`);
        }
        
        const timesheetWhereClause = timesheetWhere.length > 0 
            ? `AND ${timesheetWhere.join(' AND ')}` 
            : '';
        
        // ✅ CHANGED: Include original_sub_category in timesheet query
        const timesheetQuery = `
            SELECT 
                te.emp_id,
                e.emp_name as employee_name,
                COALESCE(te.project_id, p.id) as project_id,
                COALESCE(p.project_code, te.original_project_code) as project_code,
                COALESCE(p.project_name, te.original_project_name) as project_name,
                COALESCE(p.client_name, te.original_client_name) as client_name,
                COALESCE(p.sub_category, te.original_sub_category) as sub_category,
                COALESCE(SUM(te.hours), 0) as actual_hours,
                CASE WHEN p.id IS NOT NULL OR te.project_id IS NOT NULL THEN 1 ELSE 0 END as project_exists
            FROM timesheet_entries te
            LEFT JOIN master.emp e ON te.emp_id = e.emp_id
            LEFT JOIN projects p ON p.project_code = te.original_project_code
            WHERE 1=1 ${timesheetWhereClause}
            GROUP BY te.emp_id, e.emp_name, te.project_id, p.id, p.project_code, p.project_name, 
                     p.client_name, p.sub_category, te.original_project_code, te.original_project_name, 
                     te.original_client_name, te.original_sub_category
        `;
        
        console.log('📊 Timesheet Query:', timesheetQuery);
        console.log('📊 Timesheet Params:', timesheetParams);
        
        const timesheetData = await query(timesheetQuery, timesheetParams);

        // ─── Combine both queries using subcategory as key ──────────
        const employeeMap = new Map();
        
        // Add assignments data
        assignmentsData.forEach(a => {
            const key = `${a.emp_id}_${a.sub_category || a.project_code}`;
            employeeMap.set(key, {
                emp_id: a.emp_id,
                employee_name: a.employee_name || 'Unknown',
                project_id: a.project_id,
                project_code: a.project_code || '—',
                project_name: a.project_name || '—',
                client_name: a.client_name || '—',
                sub_category: a.sub_category || 'No Subcategory',
                assigned_units: parseFloat(a.assigned_units || 0),
                assigned_days: parseFloat(a.assigned_days || 0),
                assigned_hours: parseFloat(a.assigned_hours || 0),
                roles: a.roles || 'Not Assigned',
                actual_hours: 0,
                project_exists: true
            });
        });
        
        // Add timesheet data
        timesheetData.forEach(t => {
            const key = `${t.emp_id}_${t.sub_category || t.project_code}`;
            
            if (employeeMap.has(key)) {
                const existing = employeeMap.get(key);
                existing.actual_hours = parseFloat(t.actual_hours || 0);
                existing.project_id = t.project_id || existing.project_id;
                existing.project_code = t.project_code || existing.project_code;
                existing.project_name = t.project_name || existing.project_name;
                existing.client_name = t.client_name || existing.client_name;
                existing.sub_category = t.sub_category || existing.sub_category || 'No Subcategory';
                existing.project_exists = t.project_exists === 1;
                employeeMap.set(key, existing);
            } else {
                employeeMap.set(key, {
                    emp_id: t.emp_id,
                    employee_name: t.employee_name || 'Unknown',
                    project_id: t.project_id,
                    project_code: t.project_code || '—',
                    project_name: t.project_name || '—',
                    client_name: t.client_name || '—',
                    sub_category: t.sub_category || 'No Subcategory',
                    assigned_units: 0,
                    assigned_days: 0,
                    assigned_hours: 0,
                    roles: 'Not Assigned',
                    actual_hours: parseFloat(t.actual_hours || 0),
                    project_exists: t.project_exists === 1
                });
            }
        });

        // ─── Apply additional filters ──────────────────────────────────
        let allEmployees = Array.from(employeeMap.values());
        
        if (employeeName && !dateConditions.length) {
            allEmployees = allEmployees.filter(e => 
                e.employee_name && e.employee_name.toLowerCase().includes(employeeName.toLowerCase())
            );
        }
        
        if (clientName && !dateConditions.length) {
            allEmployees = allEmployees.filter(e => 
                e.client_name && e.client_name.toLowerCase().includes(clientName.toLowerCase())
            );
        }
        
        if (projectCode && !dateConditions.length) {
            allEmployees = allEmployees.filter(e => 
                e.project_code && e.project_code.toLowerCase().includes(projectCode.toLowerCase())
            );
        }
        
        if (projectName && !dateConditions.length) {
            allEmployees = allEmployees.filter(e => 
                e.project_name && e.project_name.toLowerCase().includes(projectName.toLowerCase())
            );
        }
        
        if (department && !dateConditions.length) {
            allEmployees = allEmployees.filter(e => 
                e.sub_category && e.sub_category.toLowerCase().includes(department.toLowerCase())
            );
        }
        
        if (reportingManager) {
            allEmployees = allEmployees.filter(e => 
                e.client_name && e.client_name.toLowerCase().includes(reportingManager.toLowerCase())
            );
        }

        // ─── Build response ──────────────────────────────────────────
        const result = allEmployees.map(e => {
            const assignedUnits = e.assigned_units;
            const assignedDays = e.assigned_days;
            const assignedHours = e.assigned_hours;
            const actual = e.actual_hours || 0;
            
            const estimatedHours = assignedHours > 0 ? assignedHours : 0;
            const estimatedDays = assignedDays > 0 ? assignedDays : 0;
            
            const variance = estimatedHours - actual;
            const variancePct = estimatedHours > 0 ? (variance / estimatedHours) * 100 : 0;
            
            let utilizationDisplay = '0%';
            if (estimatedHours > 0) {
                const utilPct = (actual / estimatedHours) * 100;
                if (utilPct > 100) {
                    utilizationDisplay = '+100%';
                } else {
                    utilizationDisplay = utilPct.toFixed(1) + '%';
                }
            } else if (actual > 0 && estimatedHours === 0) {
                utilizationDisplay = 'N/A';
            }
            
            let status = 'On Track';
            if (estimatedHours > 0) {
                if (variancePct < 0) {
                    status = 'Over Utilized';
                } else if (variancePct > 20) {
                    status = 'Under Utilized';
                } else if (variancePct > 0) {
                    status = 'Under Utilized';
                }
            } else if (!e.project_exists) {
                status = 'Project Not Found';
            } else if (estimatedHours === 0 && actual === 0) {
                status = 'No Activity';
            } else if (estimatedHours === 0 && actual > 0) {
                status = 'No Estimate';
            }
            
            let roleDisplay = 'Not Assigned';
            if (e.roles && e.roles !== 'Not Assigned') {
                const roleList = e.roles.split(',');
                roleDisplay = roleList.length > 0 ? roleList[0] : 'Not Assigned';
            }
            
            return {
                employee_code: e.emp_id || '—',
                employee_name: e.employee_name,
                reporting_manager: '—',
                project_id: e.project_id,
                project_code: e.project_code,
                project_name: e.project_name,
                client_name: e.client_name,
                sub_category: e.sub_category || 'No Subcategory', // ✅ Added subcategory
                assigned_units: assignedUnits.toFixed(1),
                assigned_days: estimatedDays.toFixed(1),
                assigned_hours: estimatedHours.toFixed(1),
                actual_hours: actual.toFixed(1),
                actual_days: (actual / 8).toFixed(1),
                variance_hours: variance.toFixed(1),
                variance_pct: variancePct.toFixed(1),
                utilization_pct: utilizationDisplay,
                role: roleDisplay,
                project_exists: e.project_exists,
                status: status
            };
        });
        
        // Sort by subcategory then employee name
        result.sort((a, b) => {
            const aSub = a?.sub_category || '';
            const bSub = b?.sub_category || '';
            if (aSub !== bSub) return aSub.localeCompare(bSub);
            const aName = a?.employee_name || '';
            const bName = b?.employee_name || '';
            return aName.localeCompare(bName);
        });
        
        res.status(200).json(result);
        
    } catch (err) {
        console.error("Employee level recon error:", err);
        res.status(500).json({ message: err.message });
    }
};

// ──────────────────────────────────────────────────────────────
// 5. GET PROJECT DETAIL (UPDATED - Uses master.emp)
// ──────────────────────────────────────────────────────────────
const getProjectDetail = async (req, res, next) => {
    try {
        const { projectId } = req.params;
        const { month, year } = req.query;
        
        if (!projectId || projectId === 'null' || projectId === 'undefined') {
            return res.status(400).json({ message: "Invalid project identifier" });
        }
        
        const isNumeric = /^\d+$/.test(projectId);
        
        let projectIdNum = null;
        let projectCode = projectId;
        let projectExists = [];
        
        if (isNumeric) {
            projectExists = await query(`SELECT id FROM projects WHERE id = ?`, [parseInt(projectId)]);
        } else {
            projectExists = await query(`SELECT id FROM projects WHERE project_code = ?`, [projectId]);
        }
        
        if (projectExists.length > 0) {
            projectIdNum = projectExists[0].id;
            const projectInfo = await query(`SELECT project_code FROM projects WHERE id = ?`, [projectIdNum]);
            if (projectInfo.length > 0) {
                projectCode = projectInfo[0].project_code;
            }
        }
        
        let projectData = [];
        let roleData = [];
        let employeeData = [];
        
        if (!projectIdNum) {
            // Project not found in system - get from timesheet_entries
            projectData = await query(`
                SELECT 
                    NULL as project_id,
                    te.original_project_code as project_code,
                    MAX(te.original_project_name) as project_name,
                    NULL as client_name,
                    0 as estimated_hours,
                    COALESCE(SUM(te.hours), 0) as actual_hours,
                    COUNT(DISTINCT te.emp_id) as employee_count,
                    0 as in_system
                FROM timesheet_entries te
                WHERE te.original_project_code = ?
                GROUP BY te.original_project_code
            `, [projectCode]);
            
            employeeData = await query(`
                SELECT 
                    te.emp_id as employee_code,
                    e.emp_name as employee_name,
                    NULL as role,
                    0 as assigned_hours,
                    0 as assigned_days,
                    COALESCE(SUM(te.hours), 0) as actual_hours,
                    COALESCE(SUM(te.hours), 0) / 8 as actual_days,
                    'Not Assigned' as assignment_status,
                    'Present' as timesheet_status,
                    0 as variance_hours,
                    0 as variance_pct,
                    0 as utilization_pct
                FROM timesheet_entries te
                LEFT JOIN master.emp e ON te.emp_id = e.emp_id
                WHERE te.original_project_code = ?
                GROUP BY te.emp_id, e.emp_name
                ORDER BY actual_hours DESC
            `, [projectCode]);
            
        } else {
            // ─── Project Found in System ────────────────────────────
            
            // ─── Get project info ─────────────────────────────────────
            projectData = await query(`
                SELECT 
                    p.id as project_id,
                    p.project_code,
                    p.project_name,
                    p.client_name,
                    p.sub_category,
                    COALESCE((SELECT SUM(total_hrs) FROM effort_estimates WHERE project_id = p.id), 0) as estimated_hours,
                    COALESCE((
                        SELECT SUM(te.hours) 
                        FROM timesheet_entries te 
                        WHERE te.project_id = p.id OR te.original_project_code = p.project_code
                    ), 0) as actual_hours,
                    COALESCE((
                        SELECT COUNT(DISTINCT te.emp_id) 
                        FROM timesheet_entries te 
                        WHERE te.project_id = p.id OR te.original_project_code = p.project_code
                    ), 0) as employee_count,
                    1 as in_system
                FROM projects p
                WHERE p.id = ?
            `, [projectIdNum]);
            
            // ─── Get Role-wise Breakdown ─────────────────────────────
            roleData = await query(`
                SELECT 
                    ee.role,
                    ee.total_hrs as estimated_hours,
                    ee.effort_days as estimated_days,
                    ee.buffer_days,
                    ee.buffer_hrs,
                    COALESCE((
                        SELECT SUM(te.hours) 
                        FROM timesheet_entries te 
                        WHERE te.project_id = ee.project_id OR te.original_project_code = p.project_code
                    ), 0) as actual_hours,
                    COALESCE((
                        SELECT SUM(te.hours) 
                        FROM timesheet_entries te 
                        WHERE te.project_id = ee.project_id OR te.original_project_code = p.project_code
                    ), 0) / 8 as actual_days,
                    (ee.total_hrs - COALESCE((
                        SELECT SUM(te.hours) 
                        FROM timesheet_entries te 
                        WHERE te.project_id = ee.project_id OR te.original_project_code = p.project_code
                    ), 0)) as variance_hours,
                    CASE 
                        WHEN ee.total_hrs > 0 
                        THEN ((ee.total_hrs - COALESCE((
                            SELECT SUM(te.hours) 
                            FROM timesheet_entries te 
                            WHERE te.project_id = ee.project_id OR te.original_project_code = p.project_code
                        ), 0)) / ee.total_hrs * 100)
                        ELSE 0 
                    END as variance_pct
                FROM effort_estimates ee
                JOIN projects p ON p.id = ee.project_id
                WHERE ee.project_id = ?
                ORDER BY ee.role
            `, [projectIdNum]);
            
            // ─── GET ALL EMPLOYEES FROM TIMESHEET using emp_id ──────
            const allTimesheetEmployees = await query(`
                SELECT 
                    te.emp_id,
                    e.emp_name as employee_name,
                    COALESCE(SUM(te.hours), 0) as actual_hours
                FROM timesheet_entries te
                LEFT JOIN master.emp e ON te.emp_id = e.emp_id
                WHERE te.project_id = ? OR te.original_project_code = ?
                GROUP BY te.emp_id, e.emp_name
                ORDER BY actual_hours DESC
            `, [projectIdNum, projectCode]);
            
            // ─── GET ALL ASSIGNMENTS FOR THIS PROJECT using emp_id ──
            const allAssignments = await query(`
                SELECT 
                    a.emp_id,
                    e.emp_name as employee_name,
                    a.role,
                    SUM(a.units_assigned) as assigned_units,
                    SUM(a.estimated_days) as assigned_days,
                    SUM(a.estimated_hours) as assigned_hours
                FROM assignments a
                LEFT JOIN master.emp e ON a.emp_id = e.emp_id
                WHERE a.project_id = ?
                GROUP BY a.emp_id, e.emp_name, a.role
            `, [projectIdNum]);
            
            // ─── Combine both using Map ──────────────────────────────
            const employeeMap = new Map();
            
            allTimesheetEmployees.forEach(e => {
                const key = e.emp_id;
                employeeMap.set(key, {
                    employee_code: e.emp_id || '—',
                    employee_name: e.employee_name || 'Unknown',
                    actual_hours: parseFloat(e.actual_hours || 0),
                    assigned_units: 0,
                    assigned_days: 0,
                    assigned_hours: 0,
                    roles: 'Not Assigned'
                });
            });
            
            allAssignments.forEach(a => {
                const key = a.emp_id;
                if (employeeMap.has(key)) {
                    const existing = employeeMap.get(key);
                    existing.assigned_units += parseFloat(a.assigned_units || 0);
                    existing.assigned_days += parseFloat(a.assigned_days || 0);
                    existing.assigned_hours += parseFloat(a.assigned_hours || 0);
                    if (a.role) {
                        existing.roles = existing.roles === 'Not Assigned' ? a.role : existing.roles + ', ' + a.role;
                    }
                    employeeMap.set(key, existing);
                } else {
                    employeeMap.set(key, {
                        employee_code: a.emp_id || '—',
                        employee_name: a.employee_name || 'Unknown',
                        actual_hours: 0,
                        assigned_units: parseFloat(a.assigned_units || 0),
                        assigned_days: parseFloat(a.assigned_days || 0),
                        assigned_hours: parseFloat(a.assigned_hours || 0),
                        roles: a.role || 'Not Assigned'
                    });
                }
            });
            
            employeeData = Array.from(employeeMap.values()).map(emp => {
                const assignedUnits = emp.assigned_units;
                const assignedDays = emp.assigned_days;
                const assignedHours = emp.assigned_hours;
                const actual = emp.actual_hours || 0;
                
                const estimatedHours = assignedHours > 0 ? assignedHours : 0;
                const estimatedDays = assignedDays > 0 ? assignedDays : 0;
                
                const variance = estimatedHours - actual;
                const variancePct = estimatedHours > 0 ? (variance / estimatedHours) * 100 : 0;
                const utilizationPct = estimatedHours > 0 ? (actual / estimatedHours) * 100 : 0;
                
                const assignmentStatus = assignedUnits > 0 ? 'Assigned' : 'Not Assigned';
                const timesheetStatus = actual > 0 ? 'Present' : 'Not Present';
                
                let roleDisplay = 'Not Assigned';
                if (emp.roles && emp.roles !== 'Not Assigned') {
                    const roleList = emp.roles.split(', ');
                    const uniqueRoles = [...new Set(roleList)];
                    roleDisplay = uniqueRoles.join(', ');
                }
                
                return {
                    employee_code: emp.employee_code,
                    employee_name: emp.employee_name,
                    role: roleDisplay,
                    assigned_units: assignedUnits,
                    assigned_days: estimatedDays,
                    assigned_hours: estimatedHours,
                    actual_hours: actual,
                    actual_days: actual / 8,
                    variance_hours: variance,
                    variance_pct: variancePct,
                    assignment_status: assignmentStatus,
                    timesheet_status: timesheetStatus,
                    utilization_pct: utilizationPct
                };
            });
            
            employeeData.sort((a, b) => a.employee_name.localeCompare(b.employee_name));
        }
        
        if (!projectData || projectData.length === 0) {
            return res.status(404).json({ message: "Project not found" });
        }
        
        const p = projectData[0];
        const estimatedHrs = parseFloat(p.estimated_hours || 0);
        const actualHrs = parseFloat(p.actual_hours || 0);
        const remainingHours = estimatedHrs - actualHrs;
        
        res.status(200).json({
            project: {
                project_id: p.project_id,
                project_code: p.project_code,
                project_name: p.project_name || p.project_code,
                client_name: p.client_name || 'Not Available',
                 sub_category: p.sub_category || 'No Subcategory', 
                estimated_hours: estimatedHrs,
                estimated_days: estimatedHrs / 8,
                actual_hours: actualHrs,
                actual_days: actualHrs / 8,
                remaining_hours: remainingHours,
                remaining_days: remainingHours / 8,
                variance_hours: estimatedHrs - actualHrs,
                variance_pct: estimatedHrs > 0 ? ((estimatedHrs - actualHrs) / estimatedHrs * 100) : 0,
                in_system: p.in_system === 1,
                utilization_pct: estimatedHrs > 0 ? (actualHrs / estimatedHrs * 100) : 0
            },
            roleSummary: roleData.map(r => ({
                role: r.role,
                estimated_hours: parseFloat(r.estimated_hours || 0),
                estimated_days: parseFloat(r.estimated_days || 0),
                buffer_days: parseFloat(r.buffer_days || 0),
                buffer_hrs: parseFloat(r.buffer_hrs || 0),
                actual_hours: parseFloat(r.actual_hours || 0),
                actual_days: parseFloat(r.actual_days || 0),
                variance_hours: parseFloat(r.variance_hours || 0),
                variance_pct: parseFloat(r.variance_pct || 0),
                utilization_pct: parseFloat(r.estimated_hours) > 0 
                    ? (parseFloat(r.actual_hours) / parseFloat(r.estimated_hours) * 100) 
                    : 0
            })),
            employeeSummary: employeeData
        });
        
    } catch (err) {
        console.error("Project detail error:", err);
        res.status(500).json({ message: err.message });
    }
};

// ──────────────────────────────────────────────────────────────
// EXPORT PROJECT LEVEL RECON TO EXCEL
// ──────────────────────────────────────────────────────────────
const exportProjectLevelRecon = async (req, res, next) => {
    try {
        let capturedData = null;
        const fakeRes = {
            json: (data) => { capturedData = data; },
            status: () => fakeRes,
        };

        await getProjectLevelRecon(req, fakeRes, next);

        if (!capturedData || !Array.isArray(capturedData)) {
            return res.status(500).json({ message: "Failed to generate reconciliation data" });
        }

        const rows = capturedData.map((item) => ({
            "Sub Category": item.sub_category || "—", // ✅ Added
            "Project Code": item.project_code || "—",
            "Project Name": item.project_name || "—",
            "Client Name": item.client_name || "—",
            "Estimated Hours": Number(item.estimated_hours || 0),
            "Estimated Days": Number(item.estimated_days || 0),
            "Actual Hours": Number(item.actual_hours || 0),
            "Actual Days": Number(item.actual_days || 0),
            "Variance Hours": Number(item.variance_hours || 0),
            "Variance %": Number(item.variance_pct || 0),
            "Status": item.status || "—",
        }));

        const worksheet = XLSX.utils.json_to_sheet(rows);
        worksheet["!cols"] = [
            { wch: 22 }, // Sub Category
            { wch: 18 }, // Project Code
            { wch: 30 }, // Project Name
            { wch: 25 }, // Client Name
            { wch: 18 }, // Estimated Hours
            { wch: 16 }, // Estimated Days
            { wch: 15 }, // Actual Hours
            { wch: 14 }, // Actual Days
            { wch: 16 }, // Variance Hours
            { wch: 12 }, // Variance %
            { wch: 18 }, // Status
        ];

        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Project Reconciliation");

        const excelBuffer = XLSX.write(workbook, { bookType: "xlsx", type: "buffer" });

        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        res.setHeader("Content-Disposition", 'attachment; filename="Project_Level_Reconciliation.xlsx"');
        return res.send(excelBuffer);
    } catch (err) {
        next(err);
    }
};

// ──────────────────────────────────────────────────────────────
// EXPORT EMPLOYEE LEVEL RECON TO EXCEL
// ──────────────────────────────────────────────────────────────
const exportEmployeeLevelRecon = async (req, res, next) => {
    try {
        let capturedData = null;
        const fakeRes = {
            json: (data) => { capturedData = data; },
            status: () => fakeRes,
        };

        await getEmployeeLevelRecon(req, fakeRes, next);

        if (!capturedData || !Array.isArray(capturedData)) {
            return res.status(500).json({ message: "Failed to generate employee reconciliation data" });
        }

        const rows = capturedData.map((item) => ({
            "Employee Code": item.employee_code || "—",
            "Employee Name": item.employee_name || "—",
            "Reporting Manager": item.reporting_manager || "—",
            "Project Code": item.project_code || "—",
            "Project Name": item.project_name || "—",
            "Sub Category": item.sub_category || "—", // ✅ Added
            "Assigned Hours": Number(item.assigned_hours || 0),
            "Actual Hours": Number(item.actual_hours || 0),
            "Variance Hours": Number(item.variance_hours || 0),
            "Variance %": Number(item.variance_pct || 0),
            "Status": item.status || "—",
        }));

        const worksheet = XLSX.utils.json_to_sheet(rows);
        worksheet["!cols"] = [
            { wch: 16 }, // Employee Code
            { wch: 26 }, // Employee Name
            { wch: 24 }, // Reporting Manager
            { wch: 18 }, // Project Code
            { wch: 28 }, // Project Name
            { wch: 22 }, // Sub Category
            { wch: 16 }, // Assigned Hours
            { wch: 14 }, // Actual Hours
            { wch: 16 }, // Variance Hours
            { wch: 12 }, // Variance %
            { wch: 18 }, // Status
        ];

        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Employee Reconciliation");

        const excelBuffer = XLSX.write(workbook, { bookType: "xlsx", type: "buffer" });

        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        res.setHeader("Content-Disposition", 'attachment; filename="Employee_Level_Reconciliation.xlsx"');
        return res.send(excelBuffer);
    } catch (err) {
        next(err);
    }
};

module.exports = {
    getReconFilters,
    getReconDashboard,
    getProjectLevelRecon,
    getEmployeeLevelRecon,
    getProjectDetail,
    exportProjectLevelRecon,
    exportEmployeeLevelRecon
};