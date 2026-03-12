const crypto = require('crypto');
const User = require('../models/User');
const Batch = require('../models/Batch');
const { generateToken, generateRefreshToken } = require('../utils/generateToken');
const sendEmail = require('../utils/sendEmail');
const logger = require('../utils/logger');
const ResponseHandler = require('../utils/responseHandler');
const { ValidationError, ConflictError, NotFoundError, UnauthorizedError, ForbiddenError } = require('../utils/errors');

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

    if (password.length < 6) {
      throw new ValidationError('Password must be at least 6 characters');
    }

    // Check if user exists
    const userExists = await User.findOne({ email: email.toLowerCase() });
    if (userExists) {
      throw new ConflictError('User with this email already exists');
    }

    // Prevent instructor self-registration - only admin and students can register
    const requestedRole = role || 'student';
    if (requestedRole === 'instructor') {
      throw new ForbiddenError('Instructors cannot self-register. Only admins can create instructor accounts.');
    }

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

      // Get the latest active batch
      const activeBatch = await Batch.findOne({ isActive: true, isDeleted: false })
        .sort({ createdAt: -1 });
      
      if (!activeBatch) {
        throw new NotFoundError('No active batch available for student registration');
      }

      userData.batch = batch;
      userData.batchId = activeBatch._id;
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
    const token = generateToken(user._id);
    const refreshToken = generateRefreshToken(user._id);

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

    const token = generateToken(user._id);
    const refreshToken = generateRefreshToken(user._id);

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

// @desc    Logout user / clear cookie
// @route   POST /api/auth/logout
// @access  Private
exports.logout = async (req, res, next) => {
  try {
    res.status(200).json({
      success: true,
      data: {},
      message: 'Logged out successfully',
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
        data: { resetToken },
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
    user.password = req.body.password;
    user.passwordResetToken = undefined;
    user.passwordResetExpires = undefined;
    await user.save();

    const token = generateToken(user._id);

    res.status(200).json({
      success: true,
      data: {
        token,
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

    user.password = req.body.newPassword;
    await user.save();

    const token = generateToken(user._id);

    res.status(200).json({
      success: true,
      data: {
        token,
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


