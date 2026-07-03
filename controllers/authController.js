const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const User = require('../models/User');
const Batch = require('../models/Batch');
const RefreshSession = require('../models/RefreshSession');
const { generateToken, generateRefreshToken } = require('../utils/generateToken');
const { jwtRefreshSecret } = require('../config/jwt');
const sendEmail = require('../utils/sendEmail');
const logger = require('../utils/logger');
const ResponseHandler = require('../utils/responseHandler');
const { ValidationError, ConflictError, NotFoundError, UnauthorizedError, ForbiddenError } = require('../utils/errors');

// ---------------------------------------------------------------------------
// Cookie helpers — dual auth strategy (HttpOnly cookie + response body bearer)
// ---------------------------------------------------------------------------

const isProduction = process.env.NODE_ENV === 'production';
const ACCESS_TOKEN_MAX_AGE_MS = 15 * 60 * 1000;       // 15 minutes
const REFRESH_TOKEN_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Sets HttpOnly access and refresh token cookies on the response.
 * These cookies are inaccessible to JavaScript (XSS-safe).
 * The tokens are ALSO returned in the response body for backward
 * compatibility with API clients and mobile apps.
 */
const setAuthCookies = (res, { token, refreshToken }) => {
  const baseOptions = {
    httpOnly: true,
    secure: isProduction,       // HTTPS only in production
    sameSite: isProduction ? 'Strict' : 'Lax', // Lax allows local dev cross-port
    path: '/',
  };

  res.cookie('token', token, {
    ...baseOptions,
    maxAge: ACCESS_TOKEN_MAX_AGE_MS,
  });

  res.cookie('refreshToken', refreshToken, {
    ...baseOptions,
    maxAge: REFRESH_TOKEN_MAX_AGE_MS,
    path: '/api/auth/refresh', // Restrict refresh cookie to refresh endpoint only
  });
};

/**
 * Clears all auth cookies (called on logout).
 */
const clearAuthCookies = (res) => {
  const baseOptions = { httpOnly: true, secure: isProduction, sameSite: isProduction ? 'Strict' : 'Lax' };
  res.clearCookie('token', { ...baseOptions, path: '/' });
  res.clearCookie('refreshToken', { ...baseOptions, path: '/api/auth/refresh' });
};

const assertStrongPassword = (password, field = 'Password') => {
  const value = String(password || '');
  const strongPattern = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z\d]).{8,64}$/;
  if (!strongPattern.test(value)) {
    throw new ValidationError(
      `${field} must be 8-64 chars and include uppercase, lowercase, number, and special character`
    );
  }
};

const selectDeterministicActiveBatch = (activeBatches, requestedTerm, seedValue) => {
  if (!activeBatches.length) return null;
  if (activeBatches.length === 1) return activeBatches[0];

  const termToken = requestedTerm === 'longTerm' ? 'long' : 'short';
  const termMatched = activeBatches.filter((batch) => String(batch.name || '').includes(termToken));
  const candidates = termMatched.length ? termMatched : activeBatches;

  const hash = crypto
    .createHash('sha256')
    .update(`${seedValue}:${requestedTerm}`)
    .digest('hex');
  const index = parseInt(hash.slice(0, 8), 16) % candidates.length;
  return candidates[index];
};

// @desc    Register user
// @route   POST /api/auth/register
// @access  Public
exports.register = async (req, res, next) => {
  try {
    const { name, email, password, mobile, role, batch } = req.body;

    // Validation
    if (!name || !email || !password) {
      throw new ValidationError('Name, email, and password are required');
    }

    // Check if user exists
    const userExists = await User.findOne({ email: email.toLowerCase() });
    if (userExists) {
      throw new ConflictError('User with this email already exists');
    }

    // Public registration is only available for students.
    const requestedRole = role || 'student';
    if (requestedRole !== 'student') {
      throw new ForbiddenError('Public registration is only available for students.');
    }

    assertStrongPassword(password);

    // Prepare user data
    const userData = {
      name: name.trim(),
      email: email.toLowerCase().trim(),
      password,
      mobile: mobile?.trim() || '',
      role: requestedRole,
    };

    // For student role: auto-assign active batch and set approvalStatus
    if (userData.role === 'student') {
      // Validate batch parameter for students
      if (!batch || !['longTerm', 'shortTerm'].includes(batch)) {
        throw new ValidationError('Valid batch term (longTerm or shortTerm) is required for students');
      }

      const activeBatches = await Batch.find({ isActive: true, isDeleted: false })
        .sort({ createdAt: 1, _id: 1 })
        .select('_id name');

      if (!activeBatches.length) {
        throw new NotFoundError('No active batch available for student registration');
      }

      const selectedBatch = selectDeterministicActiveBatch(activeBatches, batch, email.toLowerCase().trim());

      userData.batch = batch;
      userData.batchId = selectedBatch._id;
      userData.approvalStatus = 'pending'; // Students are pending by default
    }

    // Create user
    const user = await User.create(userData);

    logger.info(`New user registered: ${user._id} with role: ${user.role}`);

    // For students, do NOT return token (pending approval)
    if (user.role === 'student') {
      return ResponseHandler.created(res, {
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
          batch: user.batch,
          approvalStatus: user.approvalStatus,
        },
      }, 'Registration successful. Your account is pending admin approval.');
    }

    // For admin/instructor, return token immediately
    const sessionId = uuidv4();
    const token = generateToken(user._id, user.tokenVersion);
    const refreshToken = generateRefreshToken(user._id, user.tokenVersion, sessionId);
    const decodedRefresh = jwt.decode(refreshToken);

    await RefreshSession.create({
      userId: user._id,
      sessionId,
      userAgent: req.headers['user-agent'] || '',
      ipAddress: req.ip || req.connection?.remoteAddress || '',
      lastUsedAt: new Date(),
      expiresAt: new Date(decodedRefresh.exp * 1000),
    });

    // Set HttpOnly cookies (XSS-safe) AND return tokens in body (API client compat)
    setAuthCookies(res, { token, refreshToken });

    return ResponseHandler.created(res, {
      token,
      refreshToken,
      user: {
          id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
          batch: user.batch,
        },
      },
     'Registration successful');
  } catch (error) {
    next(error);
  }
};

// @desc    Login user
// @route   POST /api/auth/login
// @access  Public
exports.login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    // Validate inputs
    if (!email || !password) {
      throw new ValidationError('Email and password are required');
    }

    // Find user with password field
    const user = await User.findOne({ email: email.toLowerCase() })
      .select('+password')
      .populate('batchId', 'name isActive');

    if (!user) {
      throw new UnauthorizedError('Invalid email or password');
    }

    if (user.batchBlocked) {
      return ResponseHandler.error(
        res,
        new ForbiddenError('Your batch is currently inactive. Please contact the administrator.'),
        403
      );
    }

    // Check if user is blocked
    if (user.status === 'blocked') {
      logger.warn(`Login attempt by blocked user: ${user._id}`);
      throw new ForbiddenError('Your account has been blocked. Please contact administrator.');
    }

    // Check approval status for students
    if (user.role === 'student') {
      if (user.approvalStatus === 'rejected') {
        logger.warn(`Login attempt by rejected student: ${user._id}`);
        throw new ForbiddenError('Your account has been rejected. Please contact administrator.');
      }

      if (user.approvalStatus !== 'approved') {
        logger.info(`Login attempt by pending student: ${user._id}`);
        throw new ForbiddenError('Account pending admin approval');
      }
    }

    // Verify password
    const isMatch = await user.matchPassword(password);
    if (!isMatch) {
      logger.warn(`Failed login attempt for user: ${user._id}`);
      throw new UnauthorizedError('Invalid email or password');
    }

    // Update last login
    user.lastLogin = new Date();
    await user.save();

    logger.info(`User logged in: ${user._id}`);

    const sessionId = uuidv4();
    const token = generateToken(user._id, user.tokenVersion);
    const refreshToken = generateRefreshToken(user._id, user.tokenVersion, sessionId);
    const decodedRefresh = jwt.decode(refreshToken);

    await RefreshSession.create({
      userId: user._id,
      sessionId,
      userAgent: req.headers['user-agent'] || '',
      ipAddress: req.ip || req.connection?.remoteAddress || '',
      lastUsedAt: new Date(),
      expiresAt: new Date(decodedRefresh.exp * 1000),
    });

    // Set HttpOnly cookies (XSS-safe) AND return tokens in body (API client compat)
    setAuthCookies(res, { token, refreshToken });

    return ResponseHandler.success(res, {
      token,
      refreshToken,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        batch: user.batch,
        batchId: user.batchId?._id,
        avatarUrl: user.avatarUrl,
        approvalStatus: user.approvalStatus,
      },
    }, 'Login successful');
  } catch (error) {
    next(error);
  }
};

// @desc    Refresh access token
// @route   POST /api/auth/refresh
// @access  Public
exports.refresh = async (req, res, next) => {
  try {
    const refreshToken = req.cookies?.refreshToken || req.body.refreshToken;

    if (!refreshToken) {
      throw new UnauthorizedError('Refresh token is required');
    }

    const decoded = jwt.verify(refreshToken, jwtRefreshSecret);
    const user = await User.findById(decoded.id).select('-password');

    if (!user) {
      throw new UnauthorizedError('Invalid refresh token');
    }

    if ((decoded.tokenVersion ?? 0) !== (user.tokenVersion ?? 0)) {
      throw new UnauthorizedError('Refresh token has been revoked');
    }

    if (!decoded.sessionId) {
      throw new UnauthorizedError('Invalid refresh token session');
    }

    const activeSession = await RefreshSession.findOne({
      userId: user._id,
      sessionId: decoded.sessionId,
      isRevoked: false,
      expiresAt: { $gt: new Date() },
    });

    if (!activeSession) {
      throw new UnauthorizedError('Session not found or revoked');
    }

    if (user.status === 'blocked') {
      throw new ForbiddenError('Your account has been blocked. Please contact administrator.');
    }

    if (user.batchBlocked) {
      throw new ForbiddenError('Your batch is currently inactive. Please contact the administrator.');
    }

    if (user.role === 'student') {
      if (user.approvalStatus === 'rejected') {
        throw new ForbiddenError('Your account has been rejected. Please contact administrator.');
      }
      if (user.approvalStatus !== 'approved') {
        throw new ForbiddenError('Account pending admin approval');
      }
    }

    const newAccessToken = generateToken(user._id, user.tokenVersion);
    const newRefreshToken = generateRefreshToken(user._id, user.tokenVersion, decoded.sessionId);
    const newDecodedRefresh = jwt.decode(newRefreshToken);

    activeSession.lastUsedAt = new Date();
    activeSession.expiresAt = new Date(newDecodedRefresh.exp * 1000);
    await activeSession.save();

    // Rotate cookies alongside response body tokens
    setAuthCookies(res, { token: newAccessToken, refreshToken: newRefreshToken });

    return ResponseHandler.success(res, {
      token: newAccessToken,
      refreshToken: newRefreshToken,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        batch: user.batch,
        batchId: user.batchId,
        avatarUrl: user.avatarUrl,
        approvalStatus: user.approvalStatus,
      },
    }, 'Token refreshed');
  } catch (error) {
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
      return ResponseHandler.error(res, new UnauthorizedError('Invalid or expired refresh token'), 401);
    }
    return next(error);
  }
};

// @desc    Logout user / clear cookies and revoke sessions
// @route   POST /api/auth/logout
// @access  Private
exports.logout = async (req, res, next) => {
  try {
    await User.findByIdAndUpdate(req.user.id, { $inc: { tokenVersion: 1 } });
    await RefreshSession.updateMany(
      { userId: req.user.id, isRevoked: false },
      { $set: { isRevoked: true, revokedAt: new Date() } }
    );

    // Clear HttpOnly cookies
    clearAuthCookies(res);

    res.status(200).json({
      success: true,
      data: {},
      message: 'Logged out successfully. Session tokens revoked.',
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get current logged in user
// @route   GET /api/auth/me
// @access  Private
exports.getMe = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id);

    res.status(200).json({
      success: true,
      data: user,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get active sessions for current user
// @route   GET /api/auth/sessions
// @access  Private
exports.getSessions = async (req, res, next) => {
  try {
    const sessions = await RefreshSession.find({
      userId: req.user.id,
      isRevoked: false,
      expiresAt: { $gt: new Date() },
    })
      .sort({ lastUsedAt: -1 })
      .select('sessionId userAgent ipAddress lastUsedAt expiresAt createdAt');

    return ResponseHandler.success(res, sessions, 'Active sessions retrieved');
  } catch (error) {
    return next(error);
  }
};

// @desc    Revoke a single session for current user
// @route   DELETE /api/auth/sessions/:sessionId
// @access  Private
exports.revokeSession = async (req, res, next) => {
  try {
    const { sessionId } = req.params;

    const session = await RefreshSession.findOne({
      userId: req.user.id,
      sessionId,
      isRevoked: false,
    });

    if (!session) {
      throw new NotFoundError('Session');
    }

    session.isRevoked = true;
    session.revokedAt = new Date();
    await session.save();

    return ResponseHandler.success(res, {}, 'Session revoked');
  } catch (error) {
    return next(error);
  }
};

// @desc    Revoke all active sessions for current user
// @route   DELETE /api/auth/sessions
// @access  Private
exports.revokeAllSessions = async (req, res, next) => {
  try {
    const result = await RefreshSession.updateMany(
      { userId: req.user.id, isRevoked: false },
      { $set: { isRevoked: true, revokedAt: new Date() } }
    );

    await User.findByIdAndUpdate(req.user.id, { $inc: { tokenVersion: 1 } });

    return ResponseHandler.success(res, {
      revokedSessions: result.modifiedCount || 0,
    }, 'All sessions revoked');
  } catch (error) {
    return next(error);
  }
};

// @desc    Forgot password
// @route   POST /api/auth/forgotpassword
// @access  Public
exports.forgotPassword = async (req, res, next) => {
  try {
    const user = await User.findOne({ email: req.body.email });

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'There is no user with that email',
      });
    }

    // Get reset token
    const resetToken = crypto.randomBytes(20).toString('hex');

    // Hash token and set to resetPasswordToken field
    user.passwordResetToken = crypto
      .createHash('sha256')
      .update(resetToken)
      .digest('hex');
    user.passwordResetExpires = Date.now() + 10 * 60 * 1000; // 10 minutes

    await user.save({ validateBeforeSave: false });

    // Create reset url
    const resetUrl = `${process.env.FRONTEND_URL}/resetpassword/${resetToken}`;

    const message = `You are receiving this email because you (or someone else) has requested the reset of a password. Please make a PUT request to: \n\n ${resetUrl}`;

    try {
      await sendEmail({
        email: user.email,
        subject: 'Password reset token',
        message,
      });

      res.status(200).json({
        success: true,
        message: 'Email sent',
      });
    } catch (err) {
      logger.error('Email sending error:', err);
      user.passwordResetToken = undefined;
      user.passwordResetExpires = undefined;
      await user.save({ validateBeforeSave: false });

      return res.status(500).json({
        success: false,
        error: 'Email could not be sent',
      });
    }
  } catch (error) {
    next(error);
  }
};

// @desc    Reset password
// @route   PUT /api/auth/resetpassword/:resettoken
// @access  Public
exports.resetPassword = async (req, res, next) => {
  try {
    // Get hashed token
    const resetPasswordToken = crypto
      .createHash('sha256')
      .update(req.params.resettoken)
      .digest('hex');

    const user = await User.findOne({
      passwordResetToken: resetPasswordToken,
      passwordResetExpires: { $gt: Date.now() },
    });

    if (!user) {
      return res.status(400).json({
        success: false,
        error: 'Invalid token',
      });
    }

    // Set new password
    assertStrongPassword(req.body.password, 'New password');
    user.password = req.body.password;
    user.tokenVersion = (user.tokenVersion || 0) + 1;
    user.passwordResetToken = undefined;
    user.passwordResetExpires = undefined;
    await user.save();
    await RefreshSession.updateMany(
      { userId: user._id, isRevoked: false },
      { $set: { isRevoked: true, revokedAt: new Date() } }
    );

    const token = generateToken(user._id, user.tokenVersion);
    const sessionId = uuidv4();
    const refreshToken = generateRefreshToken(user._id, user.tokenVersion, sessionId);
    const decodedRefresh = jwt.decode(refreshToken);
    await RefreshSession.create({
      userId: user._id,
      sessionId,
      userAgent: req.headers['user-agent'] || '',
      ipAddress: req.ip || req.connection?.remoteAddress || '',
      lastUsedAt: new Date(),
      expiresAt: new Date(decodedRefresh.exp * 1000),
    });

    res.status(200).json({
      success: true,
      data: {
        token,
        refreshToken,
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Update password
// @route   PUT /api/auth/updatepassword
// @access  Private
exports.updatePassword = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id).select('+password');

    // Check current password
    if (!(await user.matchPassword(req.body.currentPassword))) {
      return res.status(401).json({
        success: false,
        error: 'Password is incorrect',
      });
    }

    assertStrongPassword(req.body.newPassword, 'New password');
    user.password = req.body.newPassword;
    user.tokenVersion = (user.tokenVersion || 0) + 1;
    await user.save();
    await RefreshSession.updateMany(
      { userId: user._id, isRevoked: false },
      { $set: { isRevoked: true, revokedAt: new Date() } }
    );

    const token = generateToken(user._id, user.tokenVersion);
    const sessionId = uuidv4();
    const refreshToken = generateRefreshToken(user._id, user.tokenVersion, sessionId);
    const decodedRefresh = jwt.decode(refreshToken);
    await RefreshSession.create({
      userId: user._id,
      sessionId,
      userAgent: req.headers['user-agent'] || '',
      ipAddress: req.ip || req.connection?.remoteAddress || '',
      lastUsedAt: new Date(),
      expiresAt: new Date(decodedRefresh.exp * 1000),
    });

    res.status(200).json({
      success: true,
      data: {
        token,
        refreshToken,
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};


