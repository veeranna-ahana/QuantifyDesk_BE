const jwt = require("jsonwebtoken");

// ─────────────────────────────────────────────────────────────────────────────
// authMiddleware
// Verifies JWT and attaches decoded payload to req.user.
// Use on ALL protected routes.
// ─────────────────────────────────────────────────────────────────────────────
const authMiddleware = (req, res, next) => {
  // console.log("URL:", req.originalUrl);
  // console.log("Method:", req.method);
  // console.log("Headers:", req.headers);

  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length)
    : null;

  if (!token) {
    console.warn("Authentication rejected: bearer token missing", {
      method: req.method,
      path: req.path,
    });
    return res.status(401).json({ message: "Authentication required." });
  }

  try {
    const secret =
      process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET || "dev_secret";
    const decoded = jwt.verify(token, secret);
    req.user = decoded;
    return next();
  } catch (err) {
    console.warn("Authentication rejected: bearer token verification failed", {
      method: req.method,
      path: req.path,
      reason: err.name,
    });
    return res.status(401).json({ message: "Invalid or expired token." });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// adminOnly
// Must be used AFTER authMiddleware. Rejects any non-ADMIN role.
//
// Usage in routes:
//   router.post('/', authMiddleware, adminOnly, yourController);
// ─────────────────────────────────────────────────────────────────────────────
const adminOnly = (req, res, next) => {
  // console.log("🔐 Admin middleware: Checking user role for access:", req.user);
  if (!req.user || req.user.role !== "Admin") {
    return res.status(403).json({ message: "Access denied. Admins only." });
  }
  return next();
};

module.exports = { authMiddleware, adminOnly };
