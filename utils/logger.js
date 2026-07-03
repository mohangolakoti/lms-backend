const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const path = require('path');

const logsDir = path.join(__dirname, '../logs');
const isProduction = process.env.NODE_ENV === 'production';

/**
 * Production-grade Winston logger with:
 * - Daily log rotation (prevents disk fill on Railway ephemeral disk)
 * - Structured JSON format
 * - Separate error and combined transports
 * - Console output suppressed in production
 */

/** Shared format applied to all transports */
const sharedFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.splat(),
  winston.format.json()
);

/** Daily rotate shared options */
const rotateOptions = {
  datePattern: 'YYYY-MM-DD',
  maxSize: '20m',      // Roll file after 20 MB
  maxFiles: '7d',      // Retain 7 days of logs then auto-delete
  zippedArchive: true, // Compress rotated logs to save disk
};

const logger = winston.createLogger({
  level: isProduction ? 'info' : 'debug',
  format: sharedFormat,
  defaultMeta: { service: 'lms-backend' },
  transports: [
    // Error-only rotating file
    new DailyRotateFile({
      ...rotateOptions,
      filename: path.join(logsDir, 'error-%DATE%.log'),
      level: 'error',
    }),
    // Combined rotating file (all levels)
    new DailyRotateFile({
      ...rotateOptions,
      filename: path.join(logsDir, 'combined-%DATE%.log'),
    }),
  ],
});

/** Human-readable console output in development */
if (!isProduction) {
  logger.add(new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.simple()
    ),
  }));
}

/**
 * Convenience helper for operational domain events (audit-style info logs).
 * Usage: logger.event('STUDENT_APPROVED', { userId, approvedBy })
 */
logger.event = (eventName, metadata = {}) => {
  logger.info('Operational event', {
    event: eventName,
    ...metadata,
  });
};

module.exports = logger;
