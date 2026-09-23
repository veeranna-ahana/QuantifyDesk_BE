// ============================================================================
// In-memory cache for the UAT/MyAhana access token, keyed by emp_id.
//
// WHY THIS EXISTS:
// PMS (172.16.20.61:5001) only accepts the original token issued by UAT at
// login — not our own backend's JWT. But our own JWT (signed with
// JWT_ACCESS_SECRET) is what the frontend sends on every request afterwards,
// because authSlice.js on the frontend overwrites localStorage's token with
// our JWT right after login (a deliberate, reasonable choice for OUR auth,
// but it means the UAT token is gone from the browser after that point).
//
// So instead of asking the frontend to carry a second token around and
// remember to attach it on every PMS-bound call (fragile — that's the bug
// that was already found), we cache the UAT token here, server-side, at
// login time. Any controller that needs to call PMS looks it up by
// req.user.emp_id (decoded from our own JWT by authMiddleware) instead of
// reading it from the request headers.
//
// LIMITATION — READ BEFORE DEPLOYING TO MULTIPLE INSTANCES:
// This is a plain in-memory Map. It works only as long as this app runs as
// a single Node process. If it's ever scaled horizontally (multiple pm2
// instances, multiple pods/containers), the instance that handled login
// may not be the same instance that later handles a PMS call, and the
// cache lookup will miss. At that point this needs to move to Redis or a
// shared DB table (e.g. a small `uat_token_cache` table), keyed the same
// way. Flagged here so it isn't forgotten during a scale-up.
// ============================================================================

const store = new Map(); // emp_id -> { token, expiresAt }

/**
 * Cache the UAT token for a user, with the expiry decoded from the token
 * itself where possible (see auth.controller.js), falling back to a
 * conservative default otherwise.
 */
function setUatToken(empId, token, expiresAt) {
  if (!empId || !token) return;
  store.set(empId, { token, expiresAt: expiresAt || null });
}

/**
 * Returns the cached UAT token for this emp_id, or null if there isn't one
 * or it has expired (expired entries are evicted on read).
 */
function getUatToken(empId) {
  if (!empId) return null;
  const entry = store.get(empId);
  if (!entry) return null;
  if (entry.expiresAt && Date.now() >= entry.expiresAt) {
    store.delete(empId);
    return null;
  }
  return entry.token;
}

function clearUatToken(empId) {
  if (!empId) return;
  store.delete(empId);
}

module.exports = { setUatToken, getUatToken, clearUatToken };
