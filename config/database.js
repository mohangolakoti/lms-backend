const mongoose = require('mongoose');
const logger = require('../utils/logger');

/**
 * MongoDB connection options tuned for production reliability.
 * maxPoolSize is capped to prevent exhausting Atlas M0's 500-connection limit
 * across multiple processes / deployments.
 */
const MONGO_OPTIONS = {
  // Connection pool — keep a tight cap so we never exhaust Atlas M0's 500-connection cap.
  // Scale up if moving to a dedicated cluster (M10+).
  maxPoolSize: parseInt(process.env.MONGO_MAX_POOL_SIZE || '10', 10),
  minPoolSize: parseInt(process.env.MONGO_MIN_POOL_SIZE || '2', 10),

  // Timeouts
  serverSelectionTimeoutMS: 10000, // Give up selecting a server after 10s
  socketTimeoutMS: 45000,          // Close sockets inactive for 45s
  connectTimeoutMS: 10000,         // Initial TCP connect timeout
  heartbeatFrequencyMS: 10000,     // How often to ping the server
  maxIdleTimeMS: 60000,            // Close connections idle for >60s
};

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGODB_URI, MONGO_OPTIONS);

    logger.info(`MongoDB Connected: ${conn.connection.host} (pool: max=${MONGO_OPTIONS.maxPoolSize})`);

    // Log connection pool events in development for observability
    if (process.env.NODE_ENV !== 'production') {
      mongoose.connection.on('connected', () => logger.debug('Mongoose: connected'));
      mongoose.connection.on('disconnected', () => logger.warn('Mongoose: disconnected'));
      mongoose.connection.on('reconnected', () => logger.info('Mongoose: reconnected'));
    }

    mongoose.connection.on('error', (err) => {
      logger.error(`MongoDB connection error: ${err.message}`);
    });
  } catch (error) {
    logger.error(`MongoDB connection failed: ${error.message}`);
    process.exit(1);
  }
};

/**
 * Returns current MongoDB connection health details.
 * Used by /health/ready endpoint.
 */
const getDatabaseHealth = () => {
  const state = mongoose.connection.readyState;
  const states = {
    0: 'disconnected',
    1: 'connected',
    2: 'connecting',
    3: 'disconnecting',
  };

  return {
    readyState: state,
    state: states[state] || 'unknown',
    host: mongoose.connection.host || null,
    name: mongoose.connection.name || null,
    poolSize: MONGO_OPTIONS.maxPoolSize,
  };
};

module.exports = connectDB;
module.exports.getDatabaseHealth = getDatabaseHealth;
