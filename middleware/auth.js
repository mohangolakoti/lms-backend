const jwt = require('jsonwebtoken');
const { jwtSecret } = require('../config/jwt');
const User = require('../models/User');
const logger = require('../utils/logger');
const { ForbiddenError, UnauthorizedError } = require('../utils/errors');

/**
 * Extract the JWT access token from the incoming request.
 *
 * Priority order:
 *   1. HttpOnly cookie `token` (preferred — set by backend on login)
 *   2. Authorization: Bearer <token> header (for API clients / mobile apps)
 *
 * This dual-source approach allows the web frontend to use secure cookies while
 * API clients (Postman, mobile apps, integrations) can still use bearer tokens.
 */
const extractToken = (req) => {
  // 1. Secure cookie
  if (req.cookies?.token) {
    return req.cookies.token;
  }

  // 2. Authorization header fallback
  if (req.headers.authorization?.startsWith('Bearer ')) {
    return req.headers.authorization.split(' ')[1];
  }

  return null;
};

// ---------------------------------------------------------------------------
// protect — verifies JWT and attaches req.user
// ---------------------------------------------------------------------------

/**
 * Route protection middleware.
 *
 * Validates:
 *   1. JWT authenticity and expiry
 *   2. User exists in the database
 *   3. Token version matches user.tokenVersion (prevents use of invalidated tokens)
 *   4. User is not blocked
 *   5. User's batch is not blocked (students only)
 */
exports.protect = async (req, res, next) => {
  const token = extractToken(req);

  if (!token) {
    return res.status(401).json({
      success: false,
      error: 'Not authorized to access this route',
    });
  }

  try {
    const decoded = jwt.verify(token, jwtSecret);
    const user = await User.findById(decoded.id).select('-password');

    if (!user) {
      return res.status(401).json({ success: false, error: 'User not found' });
    }

    // Token version check — instantly invalidates tokens issued before logout/password change
    if ((decoded.tokenVersion ?? 0) !== (user.tokenVersion ?? 0)) {
      return res.status(401).json({
        success: false,
        error: 'Session expired. Please login again.',
      });
    }

    if (user.status === 'blocked') {
      return res.status(403).json({
        success: false,
        error: 'Your account has been blocked. Please contact administrator.',
      });
    }

    if (user.batchBlocked === true) {
      throw new ForbiddenError(
        'Your batch is currently inactive. Access has been temporarily disabled.'
      );
    }

    req.user = user;
    next();
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return res.status(403).json({ success: false, error: error.message });
    }

    // JWT errors (expired, malformed) are not operational — log at warn level
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
      logger.warn('JWT validation failed', {
        requestId: req.requestId,
        error: error.message,
        path: req.path,
      });
      return res.status(401).json({ success: false, error: 'Not authorized to access this route' });
    }

    logger.error('Auth middleware error', {
      requestId: req.requestId,
      error: error.message,
    });
    return res.status(401).json({ success: false, error: 'Not authorized to access this route' });
  }
};

// ---------------------------------------------------------------------------
// authorize — role-based access control guard
// ---------------------------------------------------------------------------

/**
 * Role guard middleware factory.
 *
 * Usage: router.get('/admin/route', protect, authorize('admin'), handler)
 *
 * @param {...string} roles - Allowed roles
 */
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
