// const jwt = require("jsonwebtoken");

// const verifyToken = (req, res, next) => {
//   const token = req.headers["authorization"];

//   if (!token) {
//     return res.status(401).json({
//       message: "Access Denied. No Token Provided."
//     });
//   }

//   try {
//     const decoded = jwt.verify(token.split(" ")[1], process.env.JWT_SECRET);
//     req.user = decoded;
//     next();
//   } catch (error) {
//     return res.status(401).json({
//       message: "Invalid or Expired Token"
//     });
//   }
// };

// module.exports = verifyToken;

const { verifyAccessToken } = require("../helpers/helperFunctions/authHelper");

const auth = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader)
    return res.status(401).json({ message: "Token required" });

  const token = authHeader.split(" ")[1];

  try {
    const decoded = verifyAccessToken(token);
    console.log("Decoded Token:", decoded);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(403).json({ message: "Invalid token" });
  }
};

module.exports = auth;
