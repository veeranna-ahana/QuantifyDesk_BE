const axios = require('axios');

const HRMS_BASE = process.env.HRMS_BASE_URL || 'https://hr.hwtpl.com';
const TOKEN_URL = `${HRMS_BASE}/AhanaApi/Ahana/GetToken`;
const TIMESHEET_URL = `${HRMS_BASE}/AhanaApi/Ahana/GetTimeSheetData`;
const TIMEOUT = Number(process.env.HRMS_TIMEOUT_MS) || 20000;

// ─── GetToken ────────────────────────────────────────────────────────────────
// HRMS tokens are SINGLE-USE. Do NOT cache them.
async function getHrmsToken() {
  const encKey1 = process.env.EncKey1;
  const encKey2 = process.env.EncKey2;

  if (!encKey1 || !encKey2) {
    throw new Error('EncKey1 / EncKey2 not configured in .env');
  }

  const res = await axios.post(
    TOKEN_URL,
    { EncKey1: encKey1, EncKey2: encKey2 },
    {
      headers: {
        'Content-Type': 'application/json',
        Cookie: process.env.HRMS_SESSION_COOKIE || '',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      timeout: TIMEOUT,
    }
  );

  const ok =
    res.data?.success === 'true' ||
    res.data?.Success === 'true' ||
    res.data?.Sucess === 'true';

  if (!ok) {
    const msg = res.data?.message || res.data?.Message || 'Unknown HRMS error';
    throw new Error(`HRMS GetToken failed: ${msg}`);
  }

  const dataArr = res.data?.data || res.data?.Data || [];
  const flat = Array.isArray(dataArr[0]) ? dataArr[0] : dataArr;
  const row = flat?.[0]?.Table?.[0];

  if (!row?.Token || !row?.UniqueId) {
    throw new Error('HRMS token endpoint did not return Token/UniqueId');
  }

  console.log('🔑 HRMS token refreshed');
  return { token: row.Token, uniqueId: row.UniqueId };
}

// ─── GetTimeSheetData ────────────────────────────────────────────────────────
async function fetchTimesheetForProject(projectCode, { token, uniqueId }) {
  const res = await axios.post(
    TIMESHEET_URL,
    { PROJECTCODE: projectCode, Token: token, UniqueId: uniqueId },
    {
      headers: {
        'Content-Type': 'application/json',
        Cookie: process.env.HRMS_SESSION_COOKIE || '',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      timeout: TIMEOUT,
    }
  );

  return res.data;
}

module.exports = { getHrmsToken, fetchTimesheetForProject };