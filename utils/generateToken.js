const jwt = require('jsonwebtoken');
const { jwtSecret, jwtRefreshSecret, jwtExpire, jwtRefreshExpire } = require('../config/jwt');

// Generate JWT Token
const generateToken = (id) => {
  return jwt.sign({ id }, jwtSecret, {
    expiresIn: jwtExpire,
  });
};

// Generate Refresh Token
const generateRefreshToken = (id) => {
  return jwt.sign({ id }, jwtRefreshSecret, {
    expiresIn: jwtRefreshExpire,
  });
};

module.exports = { generateToken, generateRefreshToken };


