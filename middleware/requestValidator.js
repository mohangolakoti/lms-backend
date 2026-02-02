/**
 * Comprehensive request validation middleware
 */

const { ValidationError } = require('../utils/errors');

/**
 * Validate required fields
 */
exports.validateRequired = (fields = []) => {
  return (req, res, next) => {
    const body = req.body || {};
    const missing = [];

    for (const field of fields) {
      if (body[field] === undefined || body[field] === null || body[field] === '') {
        missing.push(field);
      }
    }

    if (missing.length > 0) {
      throw new ValidationError(`Missing required fields: ${missing.join(', ')}`);
    }

    next();
  };
};

/**
 * Validate email format
 */
exports.validateEmail = (field = 'email') => {
  return (req, res, next) => {
    const email = req.body[field];
    const emailRegex = /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/;

    if (email && !emailRegex.test(email)) {
      throw new ValidationError(`Invalid ${field} format`);
    }

    next();
  };
};

/**
 * Validate enum values
 */
exports.validateEnum = (field, allowedValues = []) => {
  return (req, res, next) => {
    const value = req.body[field];

    if (value !== undefined && !allowedValues.includes(value)) {
      throw new ValidationError(
        `${field} must be one of: ${allowedValues.join(', ')}`
      );
    }

    next();
  };
};

/**
 * Validate string length
 */
exports.validateLength = (field, min = 0, max = Infinity) => {
  return (req, res, next) => {
    const value = req.body[field];

    if (value !== undefined && typeof value === 'string') {
      if (value.length < min || value.length > max) {
        throw new ValidationError(
          `${field} must be between ${min} and ${max} characters`
        );
      }
    }

    next();
  };
};

/**
 * Validate MongoDB ObjectId
 */
exports.validateObjectId = (field) => {
  return (req, res, next) => {
    const value = req.body[field] || req.params[field];
    const objectIdRegex = /^[0-9a-fA-F]{24}$/;

    if (value && !objectIdRegex.test(value)) {
      throw new ValidationError(`${field} must be a valid MongoDB ID`);
    }

    next();
  };
};

/**
 * Validate number range
 */
exports.validateNumberRange = (field, min = -Infinity, max = Infinity) => {
  return (req, res, next) => {
    const value = req.body[field];

    if (value !== undefined) {
      const num = Number(value);
      if (isNaN(num) || num < min || num > max) {
        throw new ValidationError(
          `${field} must be a number between ${min} and ${max}`
        );
      }
    }

    next();
  };
};

/**
 * Validate array
 */
exports.validateArray = (field, minLength = 0, maxLength = Infinity) => {
  return (req, res, next) => {
    const value = req.body[field];

    if (value !== undefined) {
      if (!Array.isArray(value)) {
        throw new ValidationError(`${field} must be an array`);
      }

      if (value.length < minLength || value.length > maxLength) {
        throw new ValidationError(
          `${field} must contain between ${minLength} and ${maxLength} items`
        );
      }
    }

    next();
  };
};

/**
 * Sanitize input - remove extra whitespace and trim
 */
exports.sanitizeInput = (fields = []) => {
  return (req, res, next) => {
    const body = req.body || {};

    for (const field of fields) {
      if (typeof body[field] === 'string') {
        body[field] = body[field].trim();
      }
    }

    next();
  };
};

/**
 * Convert string to lowercase
 */
exports.toLowerCase = (fields = []) => {
  return (req, res, next) => {
    const body = req.body || {};

    for (const field of fields) {
      if (typeof body[field] === 'string') {
        body[field] = body[field].toLowerCase();
      }
    }

    next();
  };
};

/**
 * Chain multiple validators
 */
exports.chain = (validators = []) => {
  return (req, res, next) => {
    let index = 0;

    const callNext = (err) => {
      if (err) return next(err);

      if (index < validators.length) {
        validators[index++](req, res, callNext);
      } else {
        next();
      }
    };

    callNext();
  };
};
