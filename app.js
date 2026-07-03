const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const mongoSanitize = require('express-mongo-sanitize');
const xss = require('xss');

const errorHandler = require('./middleware/errorHandler');
const { apiLimiter, publicLimiter } = require('./middleware/rateLimiter');
const requestContext = require('./middleware/requestContext');
const swaggerUi = require('swagger-ui-express');
const swaggerJsdoc = require('swagger-jsdoc');
const { getDatabaseHealth } = require('./config/database');

const authRoutes = require('./routes/auth');
const studentRoutes = require('./routes/students');
const adminRoutes = require('./routes/admin');
const instructorRoutes = require('./routes/instructors');
const batchRoutes = require('./routes/batches');
const certificateRoutes = require('./routes/certificates');

const app = express();

// ---------------------------------------------------------------------------
// CORS origin helpers
// ---------------------------------------------------------------------------

const normalizeOrigin = (origin) => String(origin || '').trim().replace(/\/$/, '').toLowerCase();

const parseConfiguredOrigins = () => {
  const single = process.env.FRONTEND_URL ? [process.env.FRONTEND_URL] : [];
  const multiple = (process.env.FRONTEND_URLS || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  return [...single, ...multiple].map(normalizeOrigin).filter(Boolean);
};

const configuredOrigins = new Set([
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:5173',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:3001',
  'http://127.0.0.1:5173',
  'https://silicon-lms.vercel.app',
  ...parseConfiguredOrigins(),
]);

const isLocalOrigin = (o) => /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:\d+)?$/i.test(o);
const isVercelPreviewOrigin = (o) => /^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(o);

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin) return callback(null, true); // Non-browser / same-origin

    const normalized = normalizeOrigin(origin);
    const isAllowed = configuredOrigins.has(normalized)
      || isLocalOrigin(normalized)
      || isVercelPreviewOrigin(normalized);

    if (isAllowed) return callback(null, true);
    return callback(new Error(`CORS blocked for origin: ${origin}`));
  },
  credentials: true, // Required for HttpOnly cookie auth
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token'],
  optionsSuccessStatus: 200,
};

// ---------------------------------------------------------------------------
// Global middleware stack (order matters)
// ---------------------------------------------------------------------------

// 1. Security headers
app.use(helmet({
  crossOriginEmbedderPolicy: false,   // Allow embedding assets in Vercel frontend
  contentSecurityPolicy: false,       // Let Vite/React handle its own CSP for now
}));

// 2. Compress all responses (gzip) — reduces Railway egress by 60-80%
app.use(compression({
  threshold: 1024,  // Only compress responses > 1 KB
  filter: (req, res) => {
    if (req.headers['x-no-compression']) return false;
    return compression.filter(req, res);
  },
}));

// 3. CORS
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

// 4. Cookie parser (required for HttpOnly JWT cookies)
app.use(cookieParser(process.env.COOKIE_SECRET || process.env.JWT_SECRET));

// 5. Body parsers with explicit size limits to prevent memory exhaustion
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// 6. NoSQL injection sanitization (strips $ and . from user inputs)
app.use(mongoSanitize({
  replaceWith: '_',
  onSanitize: ({ req, key }) => {
    // Only log sanitization events — don't crash
    if (process.env.NODE_ENV !== 'production') {
      console.warn(`NoSQL injection attempt blocked — key: ${key}, path: ${req.path}`);
    }
  },
}));

// 7. XSS sanitization middleware using the xss library
app.use((req, _res, next) => {
  const sanitizeValue = (value) => {
    if (typeof value === 'string') return xss(value);
    if (Array.isArray(value)) {
      return value.map(sanitizeValue);
    }
    if (value && typeof value === 'object' && !Buffer.isBuffer(value)) {
      return Object.fromEntries(
        Object.entries(value).map(([k, v]) => [k, sanitizeValue(v)])
      );
    }
    return value;
  };

  if (req.body && typeof req.body === 'object') {
    req.body = sanitizeValue(req.body);
  }
  next();
});

// 8. Request context — attaches unique requestId to every request for log tracing
app.use(requestContext);

// ---------------------------------------------------------------------------
// Swagger API Documentation
// ---------------------------------------------------------------------------

const swaggerOptions = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Institutional LMS API',
      version: '1.0.0',
      description: 'API documentation for Institutional Learning Management System',
      contact: { name: 'LMS Support' },
    },
    servers: [
      {
        url: `http://localhost:${process.env.PORT || 3000}`,
        description: 'Development server',
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        cookieAuth: { type: 'apiKey', in: 'cookie', name: 'token' },
      },
    },
    security: [{ bearerAuth: [] }, { cookieAuth: [] }],
  },
  apis: ['./routes/*.js', './controllers/*.js'],
};

const swaggerSpec = swaggerJsdoc(swaggerOptions);
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// ---------------------------------------------------------------------------
// API Routes — dual mounting: versioned (/api/v1/*) + legacy (/api/*)
// ---------------------------------------------------------------------------

// Apply API rate limiter to all /api/* routes
app.use('/api/', apiLimiter);

// Versioned routes (v1) — use these going forward
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/students', studentRoutes);
app.use('/api/v1/admin', adminRoutes);
app.use('/api/v1/instructors', instructorRoutes);
app.use('/api/v1/admin/batches', batchRoutes);
app.use('/api/v1/certificates', certificateRoutes);

// Legacy routes — kept for backward compatibility with existing frontend
app.use('/api/auth', authRoutes);
app.use('/api/students', studentRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/instructors', instructorRoutes);
app.use('/api/admin/batches', batchRoutes);
app.use('/api/certificates', certificateRoutes);

// ---------------------------------------------------------------------------
// Health check endpoints (split liveness from readiness)
// ---------------------------------------------------------------------------

/**
 * Liveness probe — always returns 200 if the process is alive.
 * Use this with UptimeRobot / Railway health checks.
 */
app.get('/health/live', publicLimiter, (_req, res) => {
  res.status(200).json({ success: true, status: 'alive', timestamp: new Date().toISOString() });
});

/**
 * Readiness probe — returns 200 only if DB is connected and the app can serve traffic.
 * Use this with load balancers / orchestrators.
 */
app.get('/health/ready', publicLimiter, (req, res) => {
  const database = getDatabaseHealth();
  const healthy = database.state === 'connected';

  res.status(healthy ? 200 : 503).json({
    success: healthy,
    status: healthy ? 'ready' : 'not_ready',
    requestId: req.requestId,
    database,
    timestamp: new Date().toISOString(),
  });
});

/**
 * Legacy health endpoint — kept for backward compatibility.
 * Returns 503 if DB is not connected so UptimeRobot can detect outages.
 */
const healthHandler = (req, res) => {
  const database = getDatabaseHealth();
  const healthy = database.state === 'connected';

  res.status(healthy ? 200 : 503).json({
    success: healthy,
    message: healthy ? 'Server is running' : 'Server is degraded',
    requestId: req.requestId,
    database,
    timestamp: new Date().toISOString(),
  });
};

app.get('/health', publicLimiter, healthHandler);
app.get('/api/health', publicLimiter, healthHandler);

// ---------------------------------------------------------------------------
// Global error handler (must be last)
// ---------------------------------------------------------------------------

app.use(errorHandler);

module.exports = app;
