const axios = require('axios');
const XLSX = require('xlsx');

// Main function to get timesheet data for specific project category and export to Excel
const getFilteredTimesheetData = async (req, res) => {
  try {
    const { 
      projectCategoryName = "Flow management application development (NBD2790)",
      projectCode = "I:A&A:SP:PROJCT"
    } = req.body;
    
    console.log("========================================");
    console.log("Starting Excel Export");
    console.log("Project Category:", projectCategoryName);
    console.log("Project Code:", projectCode);
    console.log("========================================");
    
    // Step 1: Get token
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
      }
    );
    
    const token = tokenResponse?.data?.data?.[0]?.Table?.[0]?.Token;
    if (!token) {
      console.error("Failed to get token");
      return res.status(500).json({
        success: false,
        error: "Failed to get authentication token"
      });
    }
    
    const uniqueId = "29293";
    console.log("✓ Token obtained successfully");

    // Step 2: Get timesheet data
    const timesheetResponse = await axios.post(
      "https://hr.hwtpl.com/AhanaApi/Ahana/GetTimeSheetData",
      {
        PROJECTCODE: projectCode,
        Token: token,
        UniqueId: uniqueId,
      },
      {
        headers: {
          "Content-Type": "application/json",
          Cookie: "ASP.NET_SessionId=im0vi4l3zk0tnkkbzzmalinv",
        },
      }
    );

    console.log("✓ Timesheet data received");

    // Step 3: Filter for specific project category name
    const filteredData = filterTimesheetData(timesheetResponse?.data?.data || [], projectCategoryName);
    
    console.log(`✓ Found ${filteredData.length} records for project category`);

    if (filteredData.length === 0) {
      return res.status(404).json({
        success: false,
        message: `No records found for project category: ${projectCategoryName}`,
        data: []
      });
    }

    // Step 4: Get employee details for each entry
    const enrichedData = await enrichWithEmployeeDetails(filteredData);
    
    console.log(`✓ Enriched ${enrichedData.length} records with employee details`);

    // Step 5: Export to Excel
    const excelBuffer = await exportToExcel(enrichedData, projectCategoryName);
    
    console.log(`✓ Excel file generated successfully, size: ${(excelBuffer.length / 1024).toFixed(2)} KB`);
    console.log("========================================");
    
    // Return Excel file as download
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=timesheet_${projectCategoryName.replace(/[^a-zA-Z0-9]/g, '_')}_${new Date().toISOString().split('T')[0]}.xlsx`);
    res.setHeader('Content-Length', excelBuffer.length);
    
    return res.send(excelBuffer);
    
  } catch (error) {
    console.error("❌ Error in getFilteredTimesheetData:", error);
    return res.status(500).json({ 
      success: false, 
      error: error.message,
      details: error.response?.data || "Unknown error"
    });
  }
};


module.exports = {
  getFilteredTimesheetData,
};