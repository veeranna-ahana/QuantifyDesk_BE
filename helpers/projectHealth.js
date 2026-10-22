// ============================================================================
// Shared project-health classification — the single source of truth for "our
// application's own status" for an imported project (On Track / In Progress /
// At Risk / Delayed / Completed / On Hold), derived from PMS's raw status +
// dates + tasks.
//
// Previously this logic (classifyProject/healthBucketLabel/distributionBucketLabel)
// lived only in quantifyDashboard.controller.js and powered the Dashboard's Project
// Delivery Performance table. Project Overview (importProject.controller.js's
// getProjectView) showed PMS's raw `projectDetails.status` instead — so the SAME
// project could show "On Hold" on Project Overview but "In Progress" on the
// Dashboard, because the two screens used two different notions of "status" and
// the Dashboard's own onHold classification was never consulted by its label
// function (see the healthBucketLabel fix below).
//
// Per team lead's decision: Project Overview must show the SAME status our own
// application computes (this module), not PMS's raw text, regardless of which
// screen the user navigated from (Projects main page, or Dashboard → Project
// Delivery Performance → View). Extracted here so both controllers call the exact
// same function and can never drift apart again.
// ============================================================================

// Maps PMS's own task status values straight to our three buckets. PMS only ever sends exactly
// "COMPLETED", "STARTED", or "YET_TO_START" for a task's `status` (confirmed against a real
// getProjectDetails response).
function normalizeTaskStatus(rawStatus) {
  const status = String(rawStatus || "").toUpperCase();

  if (status === "COMPLETED") {
    return "completed";
  }
  if (status === "STARTED") {
    return "in_progress";
  }
  return "not_started";
}

// ─────────────────────────────────────────────────────────────────────────
// Classifies ONE imported project into the dashboard's buckets from its PMS tasks, dates and
// status. Rules, first match wins:
//
//   Completed   every task is COMPLETED (even if that happened after the planned end date), or
//               PMS itself says the project is complete.
//   Delayed     not completed, and the planned end date has passed.
//   On Hold     not completed, not delayed, and PMS's status text says hold/inactive.
//   At Risk     not completed, not yet delayed, not on hold, and the planned end date is within
//               the next AT_RISK_DAYS days (today counts).
//   On Track    otherwise, when the share of tasks completed is at least the share of the
//               planned timeline that has passed (50% done at the halfway point = On Track).
//   In Progress otherwise: work has started but is behind that pace.
//
// A project with no tasks, or no usable dates, can't be judged on pace, so it falls back to the
// PMS status text: "progress" → In Progress, anything else → On Track.
// ─────────────────────────────────────────────────────────────────────────
const AT_RISK_DAYS = 3;

// Whole-day number for a PMS date ("2026-10-30" or "2026-10-30T00:00:00.000Z" → its calendar
// day), so comparisons ignore time of day and time zones. null when the value isn't a date.
function dayNumber(value) {
  if (!value) return null;
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) return Date.UTC(+match[1], +match[2] - 1, +match[3]) / 86400000;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return (
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000
  );
}

function classifyProject({
  rawStatus,
  plannedStartDate,
  plannedEndDate,
  tasks,
}) {
  const status = String(rawStatus || "").toLowerCase();
  const taskList = Array.isArray(tasks) ? tasks : [];
  const totalTasks = taskList.length;
  const completedTasks = taskList.filter(
    (t) => normalizeTaskStatus(t.status) === "completed",
  ).length;

  const completed =
    (totalTasks > 0 && completedTasks === totalTasks) ||
    status.includes("complete") ||
    status.includes("done");

  const now = new Date();
  const today =
    Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / 86400000;

  // Planned start: the project's own date, else the earliest planned task start
  let startDay = dayNumber(plannedStartDate);
  if (startDay === null) {
    const taskStarts = taskList
      .map((t) => dayNumber(t.planned_start_date))
      .filter((d) => d !== null);
    startDay = taskStarts.length ? Math.min(...taskStarts) : null;
  }
  const endDay = dayNumber(plannedEndDate);

  const delayed = !completed && endDay !== null && endDay < today;
  const onHold =
    !completed &&
    !delayed &&
    (status.includes("hold") || status.includes("inactive"));

  const atRisk =
    !completed &&
    !delayed &&
    !onHold &&
    endDay !== null &&
    endDay - today <= AT_RISK_DAYS;

  // Pace: share of tasks completed vs share of the planned timeline already used
  let onTrack;
  if (
    totalTasks > 0 &&
    startDay !== null &&
    endDay !== null &&
    endDay > startDay
  ) {
    const elapsed = Math.min(
      Math.max((today - startDay) / (endDay - startDay), 0),
      1,
    );
    onTrack = completedTasks / totalTasks >= elapsed;
  } else {
    onTrack = !status.includes("progress");
  }

  return {
    completed,
    delayed,
    onHold,
    atRisk,
    onTrack: !completed && !delayed && !onHold && !atRisk && onTrack,
    inProgress: !completed && !delayed && !onHold && !atRisk && !onTrack,
  };
}

// The single label the Health Overview chart, the dashboard cards, the Delivery Performance
// STATUS column AND Project Overview's status (both navigation paths) all use.
//
// BUG FIX: this used to fall straight from atRisk/onTrack to the catch-all "In Progress" without
// ever checking classification.onHold — so an On Hold project (classification.onHold === true,
// computed correctly above) silently fell through to "In Progress"/"On Track" here instead of
// being reported as its own bucket. onHold is checked first (right after completed/delayed,
// since classifyProject already makes onHold mutually exclusive with both of those) so an
// On Hold project is never miscategorized as anything else.
function healthBucketLabel(classification) {
  if (classification.completed) return "Completed";
  if (classification.delayed) return "Delayed";
  if (classification.onHold) return "On Hold";
  if (classification.atRisk) return "At Risk";
  if (classification.onTrack) return "On Track";
  return "In Progress";
}

// The Status Distribution donut's label (unchanged — already handled onHold correctly).
function distributionBucketLabel(classification) {
  if (classification.completed) return "Completed";
  if (classification.delayed) return "Delayed";
  if (classification.onHold) return "On Hold";
  return "Active";
}

module.exports = {
  normalizeTaskStatus,
  classifyProject,
  healthBucketLabel,
  distributionBucketLabel,
};
