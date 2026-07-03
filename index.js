require('dotenv').config();

const logger = require('./utils/logger');

// ---------------------------------------------------------------------------
// Environment validation — fail fast before any module initialises
// ---------------------------------------------------------------------------

const REQUIRED_ENV = [
  'MONGODB_URI',
  'JWT_SECRET',
  'JWT_REFRESH_SECRET',
];

const missingEnv = REQUIRED_ENV.filter((key) => !process.env[key]);
if (missingEnv.length) {
  // Use console.error here since the logger may not be fully initialised yet
  // eslint-disable-next-line no-console
  console.error(`[FATAL] Missing required environment variables: ${missingEnv.join(', ')}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Application bootstrap
// ---------------------------------------------------------------------------

const connectDB = require('./config/database');
const mongoose = require('mongoose');
const app = require('./app');
const { processNext } = require('./utils/certificateQueue');
const { processNextBatch } = require('./utils/emailQueue');
const sendEmail = require('./utils/sendEmail');

const PORT = process.env.PORT || 3000;

let server;

/**
 * Graceful shutdown handler.
 * Triggered by SIGTERM (Railway deploy/scale) or SIGINT (Ctrl+C).
 * Stops accepting new connections, drains in-flight requests, then closes DB.
 */
const gracefulShutdown = (signal) => {
  logger.info(`${signal} received — starting graceful shutdown`);

  // Close the SMTP pool first (non-blocking)
  try {
    sendEmail.closeTransporter();
  } catch { /* ignore */ }

  if (!server) {
    logger.warn('Server not started — exiting immediately');
    process.exit(0);
    return;
  }

  server.close(async () => {
    logger.info('HTTP server closed — closing MongoDB connection');
    try {
      await mongoose.connection.close(false);
      logger.info('MongoDB connection closed — shutdown complete');
    } catch (err) {
      logger.error(`MongoDB close error: ${err.message}`);
    }
    process.exit(0);
  });

  // Force-exit after 15 seconds if graceful close takes too long
  setTimeout(() => {
    logger.error('Graceful shutdown timed out — forcing exit');
    process.exit(1);
  }, 15_000).unref();
};

const startServer = async () => {
  // 1. Connect to MongoDB
  await connectDB();

  // 2. Start HTTP server
  server = app.listen(PORT, () => {
    logger.info(`Server running in ${process.env.NODE_ENV || 'development'} mode on port ${PORT}`);
  });

  // 3. Drain any queued certificate & email jobs that were interrupted by a previous restart
  processNext().catch((err) => logger.error('Certificate queue startup drain error', { error: err.message }));
  processNextBatch().catch((err) => logger.error('Email queue startup drain error', { error: err.message }));

  // 4. Periodic queues watchdog — picks up any stuck jobs every 5 minutes
  setInterval(() => {
    processNext().catch((err) =>
      logger.error('Certificate queue watchdog error', { error: err.message })
    );
    processNextBatch().catch((err) =>
      logger.error('Email queue watchdog error', { error: err.message })
    );
  }, 5 * 60 * 1000).unref(); // unref() so the interval doesn't prevent shutdown
};

// ---------------------------------------------------------------------------
// Process event handlers
// ---------------------------------------------------------------------------

if (require.main === module) {
  startServer().catch((err) => {
    logger.error(`Startup error: ${err.message}`, { stack: err.stack });
    process.exit(1);
  });

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));

  process.on('unhandledRejection', (err) => {
    logger.error(`Unhandled rejection: ${err.message}`, { stack: err?.stack });
    gracefulShutdown('unhandledRejection');
  });

  process.on('uncaughtException', (err) => {
    logger.error(`Uncaught exception: ${err.message}`, { stack: err.stack });
    gracefulShutdown('uncaughtException');
  });
}

module.exports = { app, startServer };
