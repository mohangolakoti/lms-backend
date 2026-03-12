const jwt = require('jsonwebtoken');
const { jwtSecret } = require('../config/jwt');
const User = require('../models/User');
const logger = require('../utils/logger');
const { ForbiddenError } = require('../utils/errors');

// Protect routes
exports.protect = async (req, res, next) => {
  let token;

  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) {
    return res.status(401).json({
      success: false,
      error: 'Not authorized to access this route',
    });
  }

  try {
    const decoded = jwt.verify(token, jwtSecret);
    req.user = await User.findById(decoded.id).select('-password');
    
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'User not found',
      });
    }

    // Check if user is blocked
    if (req.user.status === 'blocked') {
      return res.status(403).json({
        success: false,
        error: 'Your account has been blocked. Please contact administrator.',
      });
    }

    // Check if user's batch is inactive
    if (req.user.batchBlocked === true) {
      throw new ForbiddenError(
        'Your batch is currently inactive. Access has been temporarily disabled.'
      );
    }

    next();
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return res.status(403).json({
        success: false,
        error: error.message,
      });
    }

    logger.error('Auth middleware error:', error);
    return res.status(401).json({
      success: false,
      error: 'Not authorized to access this route',
    });
  }
};

// Grant access to specific roles
exports.authorize = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        error: `User role '${req.user.role}' is not authorized to access this route`,
      });
    }
    next();
  };
};


