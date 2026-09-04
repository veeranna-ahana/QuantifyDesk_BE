const jwt = require("jsonwebtoken");

module.exports = {
  generateAccessToken(user) {
    return jwt.sign(
      user,
      process.env.JWT_ACCESS_SECRET,
      { expiresIn: process.env.JWT_ACCESS_EXPIRES }
    );
  },

  generateRefreshToken(user) {
    return jwt.sign(
      user,
      process.env.JWT_REFRESH_SECRET,
      { expiresIn: process.env.JWT_REFRESH_EXPIRES }
    );
  },

  verifyAccessToken(token) {
    return jwt.verify(token, process.env.JWT_ACCESS_SECRET);
  },

  verifyRefreshToken(token) {
    return jwt.verify(token, process.env.JWT_REFRESH_SECRET);
  }
};
