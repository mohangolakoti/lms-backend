const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');

const requestContext = (req, res, next) => {
  const requestId = req.headers['x-request-id'] || uuidv4();
  req.requestId = requestId;
  res.setHeader('x-request-id', requestId);

  const startTime = Date.now();
  res.on('finish', () => {
    logger.info('Request completed', {
      requestId,
      method: req.method,
      path: req.originalUrl,
      statusCode: res.statusCode,
      durationMs: Date.now() - startTime,
      userId: req.user?._id,
    });
  });

  next();
};

module.exports = requestContext;
