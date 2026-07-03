const rateLimit = require('express-rate-limit');

/**
 * Rate limiting middleware — production-grade.
 *
 * Uses in-memory store by default (fast, zero-dependency) but automatically
 * switches to a MongoDB-backed store when MONGODB_URI is available, making
 * rate-limit counts persistent across Railway restarts and horizontally shared
 * across multiple instances.
 *
 * To use the Mongo store, install: npm install rate-limit-mongo
 *
 * The in-memory fallback is intentional — it keeps tests lightweight and
 * works perfectly in single-process deployments.
 */

const isTest = process.env.NODE_ENV === 'test';

/**
 * Build a MongoDB rate-limit store if the package is available and MONGODB_URI is set.
 * Falls back to undefined (in-memory store) gracefully.
 */
const buildMongoStore = (collectionName, windowMs) => {
  if (isTest || !process.env.MONGODB_URI) return undefined;

  try {
    // eslint-disable-next-line global-require
    const MongoStore = require('rate-limit-mongo');
    return new MongoStore({
      uri: process.env.MONGODB_URI,
      collectionName,
      expireTimeMs: windowMs,
      errorHandler: (err) => {
        // eslint-disable-next-line no-console
        console.error(`Rate-limit store error [${collectionName}]:`, err.message);
      },
    });
  } catch {
    // rate-limit-mongo not installed — fall back to in-memory store
    return undefined;
  }
};

const API_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const AUTH_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

/**
 * General API rate limiter — applied to all /api/* routes.
 * 300 req / 15 min per IP (20 req/min average).
 */
exports.apiLimiter = rateLimit({
  windowMs: API_WINDOW_MS,
  max: isTest ? 10000 : 300,
  message: { success: false, error: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  store: buildMongoStore('rateLimits_api', API_WINDOW_MS),
  skip: (req) => req.method === 'OPTIONS',
});

/**
 * Strict auth rate limiter — applied to login / register / password endpoints.
 * 10 attempts / 15 min per IP to deter brute force attacks.
 */
exports.authLimiter = rateLimit({
  windowMs: AUTH_WINDOW_MS,
  max: isTest ? 10000 : 10,
  message: { success: false, error: 'Too many authentication attempts, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  store: buildMongoStore('rateLimits_auth', AUTH_WINDOW_MS),
  skip: (req) => req.method === 'OPTIONS',
});

/**
 * Lenient limiter for public read-only endpoints (health check, certificate verify).
 * 600 req / 15 min per IP.
 */
exports.publicLimiter = rateLimit({
  windowMs: API_WINDOW_MS,
  max: isTest ? 10000 : 600,
  message: { success: false, error: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.method === 'OPTIONS',
});
