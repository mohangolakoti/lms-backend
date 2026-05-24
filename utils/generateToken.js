const jwt = require('jsonwebtoken');
const { jwtSecret, jwtRefreshSecret, jwtExpire, jwtRefreshExpire } = require('../config/jwt');

// Generate JWT Token
const generateToken = (id) => {
  return jwt.sign({ id }, jwtSecret, {
    expiresIn: jwtExpire,
  });
};

// Generate Refresh Token
const generateRefreshToken = (id, tokenVersion = 0, sessionId = null) => {
  return jwt.sign({ id, tokenVersion, sessionId }, jwtRefreshSecret, {
    expiresIn: jwtRefreshExpire,
  });
};

module.exports = { generateToken, generateRefreshToken };


