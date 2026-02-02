const logger = require('../utils/logger');
const ResponseHandler = require('../utils/responseHandler');
const { AppError } = require('../utils/errors');

const errorHandler = (err, req, res, next) => {
  // Set defaults
  let error = err;
  let statusCode = 500;
  let message = 'Internal server error';

  logger.error(`[Error] ${err.message}`, {
    code: err.code,
    name: err.name,
    statusCode: err.statusCode,
    path: req.path,
    method: req.method,
    userId: req.user?._id,
  });

  // Handle custom AppError
  if (err instanceof AppError) {
    statusCode = err.statusCode;
    message = err.message;
    return ResponseHandler.error(res, err, statusCode, { code: err.code });
  }

  // Mongoose bad ObjectId
  if (err.name === 'CastError') {
    statusCode = 404;
    message = 'Invalid ID format';
  }

  // Mongoose duplicate key (E11000)
  if (err.code === 11000) {
    statusCode = 409;
    const field = Object.keys(err.keyPattern)[0];
    message = `${field} already exists`;
  }

  // Mongoose validation error
  if (err.name === 'ValidationError') {
    statusCode = 400;
    const details = Object.values(err.errors).map(val => ({
      field: val.path,
      message: val.message,
    }));
    message = 'Validation failed';
    return ResponseHandler.error(res, err, statusCode, { details });
  }

  // JSON parsing errors
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    statusCode = 400;
    message = 'Invalid JSON';
  }

  // Generic error response
  return ResponseHandler.error(res, new Error(message), statusCode);
};

module.exports = errorHandler;



