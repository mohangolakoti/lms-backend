require('dotenv').config();
const connectDB = require('./config/database');
const logger = require('./utils/logger');
const app = require('./app');

const PORT = process.env.PORT || 3000;

let server;

const startServer = async () => {
  await connectDB();
  server = app.listen(PORT, () => {
    logger.info(`Server running in ${process.env.NODE_ENV} mode on port ${PORT}`);
  });
};

if (require.main === module) {
  startServer().catch((err) => {
    logger.error(`Startup error: ${err.message}`);
    process.exit(1);
  });

  process.on('unhandledRejection', (err) => {
    logger.error(`Error: ${err.message}`);
    if (server) {
      server.close(() => process.exit(1));
      return;
    }
    process.exit(1);
  });
}

module.exports = { app, startServer };


