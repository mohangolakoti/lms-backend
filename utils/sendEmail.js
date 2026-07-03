const nodemailer = require('nodemailer');
const logger = require('./logger');

/**
 * Singleton SMTP transporter with connection pooling.
 *
 * Creating a new transporter per email call wastes SMTP connections — especially
 * critical when sending batch announcement emails to 1k+ students. A single pooled
 * transporter is created once at module load and reused for the lifetime of the process.
 *
 * Configuration is read from environment variables so it works unchanged across
 * Nodemailer (Gmail SMTP), SendGrid, Postmark, Amazon SES, etc.
 */
const createTransporter = () => {
  const port = parseInt(process.env.EMAIL_PORT || '587', 10);

  return nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port,
    secure: port === 465, // true for port 465 (SSL), false for STARTTLS (587)
    pool: true,           // Reuse SMTP connections instead of creating new per email
    maxConnections: parseInt(process.env.EMAIL_MAX_CONNECTIONS || '5', 10),
    maxMessages: parseInt(process.env.EMAIL_MAX_MESSAGES || '100', 10), // Max emails per connection
    rateDelta: 1000,      // 1 second window for rate limiting
    rateLimit: 5,         // Max 5 emails per rateDelta window
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
    // Graceful fallback: don't crash the server if email isn't configured
    logger: process.env.NODE_ENV === 'development',
    debug: false,
  });
};

/** Module-level singleton — initialized lazily on first use */
let transporter = null;

const getTransporter = () => {
  if (!transporter) {
    transporter = createTransporter();
  }
  return transporter;
};

/**
 * Send a single email.
 *
 * @param {object} options
 * @param {string} options.email     - Recipient email address
 * @param {string} options.subject   - Email subject line
 * @param {string} [options.message] - Plain-text body
 * @param {string} [options.html]    - HTML body (takes precedence over message)
 */
const sendEmail = async (options) => {
  if (!process.env.EMAIL_HOST || !process.env.EMAIL_USER) {
    logger.warn('Email not configured — skipping send', { to: options.email, subject: options.subject });
    return;
  }

  const message = {
    from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
    to: options.email,
    subject: options.subject,
    text: options.message,
    html: options.html,
  };

  try {
    const info = await getTransporter().sendMail(message);
    logger.info(`Email sent to ${options.email}`, { messageId: info.messageId });
    return info;
  } catch (error) {
    logger.error('Email sending failed', { to: options.email, error: error.message });
    throw new Error('Email could not be sent');
  }
};

/**
 * Gracefully close the SMTP pool (called during graceful shutdown).
 */
const closeTransporter = () => {
  if (transporter) {
    transporter.close();
    transporter = null;
  }
};

module.exports = sendEmail;
module.exports.closeTransporter = closeTransporter;
module.exports.getTransporter = getTransporter;
