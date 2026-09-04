const jwt = require('jsonwebtoken');

// ─────────────────────────────────────────────────────────────────────────────
// authMiddleware
// Verifies JWT and attaches decoded payload to req.user.
// Use on ALL protected routes.
// ─────────────────────────────────────────────────────────────────────────────
const authMiddleware = (req, res, next) => {
  console.log("URL:", req.originalUrl);
  console.log("Method:", req.method);
  console.log("Headers:", req.headers);
  
  const authHeader = req.headers['authorization'] || req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    console.warn("⚠️ Auth middleware: Authorization header missing or malformed");
    return res.status(401).json({ message: 'Authorization token missing or malformed.' });
  }

  const token = authHeader.split(' ')[1];
  console.log("🔐 Auth middleware: Verifying token:", token.substring(0, 20) + "...");

  try {
    const secret = process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET || 'dev_secret';
    const decoded = jwt.verify(token, secret);
    console.log("Auth middleware: Token verified successfully for user:", decoded.emp_id);
    req.user = decoded;
    console.log("Auth middleware: Token verified for user:", decoded.emp_id);
    return next();
  } catch (err) {
    console.error(" Auth middleware: Token verification failed:", err.message);
    return res.status(401).json({ message: 'Invalid or expired token.' });
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
  console.log("🔐 Admin middleware: Checking user role for access:", req.user);
  if (!req.user || req.user.role !== 'Admin') {
    return res.status(403).json({ message: 'Access denied. Admins only.' });
  }
  return next();
};

module.exports = { authMiddleware, adminOnly };
