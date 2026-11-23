const jwt = require("jsonwebtoken");

module.exports = {
  generateAccessToken(user, expiresIn) {
    return jwt.sign(
      user,
      process.env.JWT_ACCESS_SECRET,
      { expiresIn: expiresIn || process.env.JWT_ACCESS_EXPIRES || "8h" }
    );
  },

  verifyAccessToken(token) {
    return jwt.verify(token, process.env.JWT_ACCESS_SECRET);
  },
};
