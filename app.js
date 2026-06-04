const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const errorHandler = require('./middleware/errorHandler');
const { apiLimiter } = require('./middleware/rateLimiter');
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

const normalizeOrigin = (origin) => String(origin || '').trim().replace(/\/$/, '').toLowerCase();

const parseConfiguredOrigins = () => {
  const single = process.env.FRONTEND_URL ? [process.env.FRONTEND_URL] : [];
  const multiple = (process.env.FRONTEND_URLS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  return [...single, ...multiple]
    .map(normalizeOrigin)
    .filter(Boolean);
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

const isLocalOrigin = (origin) => /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:\d+)?$/i.test(origin);
const isVercelPreviewOrigin = (origin) => /^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(origin);

const corsOptions = {
  origin: (origin, callback) => {
    // Allow non-browser clients and same-origin requests with no Origin header.
    if (!origin) {
      return callback(null, true);
    }

    const normalized = normalizeOrigin(origin);
    const isAllowed = configuredOrigins.has(normalized)
      || isLocalOrigin(normalized)
      || isVercelPreviewOrigin(normalized);

    if (isAllowed) {
      return callback(null, true);
    }

    return callback(new Error(`CORS blocked for origin: ${origin}`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  // Let cors package reflect requested preflight headers automatically.
  // This avoids local-dev breakage from browser/client-hint header variations.
  optionsSuccessStatus: 200,
};

app.use(helmet());
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(requestContext);

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
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
    },
    security: [{ bearerAuth: [] }],
  },
  apis: ['./routes/*.js', './controllers/*.js'],
};

const swaggerSpec = swaggerJsdoc(swaggerOptions);
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

app.use('/api/', apiLimiter);
app.use('/api/auth', authRoutes);
app.use('/api/students', studentRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/instructors', instructorRoutes);
app.use('/api/admin/batches', batchRoutes);
app.use('/api/certificates', certificateRoutes);

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

app.get('/health', healthHandler);
app.get('/api/health', healthHandler);

app.use(errorHandler);

module.exports = app;
