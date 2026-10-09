// helpers/experience.js

/**
 * "03-10-2017" → 8.1 (years and months, decimals).
 */
function calcExperienceYears(doj) {
  if (!doj) return null;

  const m = String(doj).match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (!m) return null;

  const [, dd, mm, yyyy] = m;
  const start = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
  const now = new Date();

  const totalMonths =
    (now.getFullYear() - start.getFullYear()) * 12 +
    (now.getMonth() - start.getMonth()) -
    (now.getDate() < start.getDate() ? 1 : 0);

  if (totalMonths < 0) return 0;

  const years = Math.floor(totalMonths / 12);
  const months = totalMonths % 12;

  // 9 years 8 months → 9.7 (rounded to one decimal; 8/12 ≈ 0.67 → 0.7)
  return Number((years + months / 12).toFixed(1));
}

module.exports = { calcExperienceYears };