const crypto = require('crypto');
const puppeteer = require('puppeteer');
const { uploadFile } = require('./storageService');

/**
 * Certificate generation service — production-grade version.
 *
 * Key change from original implementation:
 *   OLD: Write PDF to local disk (`./uploads/certificates/pdfs/`)
 *   NEW: Generate PDF into an in-memory Buffer, upload to Cloudflare R2.
 *
 * This eliminates the Railway ephemeral disk blocker — certificates are
 * durably stored in object storage and survive container restarts/redeploys.
 */

// ---------------------------------------------------------------------------
// Default HTML certificate template
// ---------------------------------------------------------------------------

const defaultHtmlTemplate = `
<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    @page {
      size: A4 landscape;
      margin: 0;
    }

    html, body {
      margin: 0;
      padding: 0;
      width: 100%;
      height: 100%;
      font-family: Georgia, "Times New Roman", serif;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    .certificate {
      width: 1123px;
      height: 794px;
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
      text-align: center;
      background-size: cover;
      background-position: center;
      background-image: url('{{background_image}}');
    }

    .overlay {
      width: 85%;
      background: rgba(255, 255, 255, 0.75);
      border-radius: 10px;
      padding: 48px;
      box-sizing: border-box;
    }

    .title {
      font-size: 52px;
      margin: 0;
      letter-spacing: 1px;
    }

    .subtitle {
      margin-top: 14px;
      font-size: 20px;
      color: #333;
    }

    .name {
      margin-top: 22px;
      font-size: 44px;
      font-weight: 700;
      color: #111;
    }

    .meta {
      margin-top: 20px;
      font-size: 20px;
      color: #222;
      line-height: 1.8;
    }

    .footer {
      margin-top: 28px;
      font-size: 15px;
      color: #444;
      display: flex;
      justify-content: space-between;
    }
  </style>
</head>
<body>
  <div class="certificate">
    <div class="overlay">
      <h1 class="title">Certificate of Completion</h1>
      <p class="subtitle">This is proudly awarded to</p>
      <div class="name">{{student_name}}</div>
      <div class="meta">
        for successfully completing <strong>{{certificate_name}}</strong><br/>
        in <strong>{{batch_name}}</strong> for a duration of <strong>{{duration}}</strong><br/>
        on <strong>{{completion_date}}</strong>
      </div>
      <div class="footer">
        <span>Certificate ID: {{certificate_id}}</span>
        <span>Issued: {{completion_date}}</span>
      </div>
    </div>
  </div>
</body>
</html>
`;

// ---------------------------------------------------------------------------
// Template helpers
// ---------------------------------------------------------------------------

/**
 * Replaces `{{key}}` placeholders in an HTML template string with values.
 */
const renderTemplate = (htmlTemplate, values) => {
  return htmlTemplate.replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (_, key) => {
    return values[key] !== undefined && values[key] !== null ? String(values[key]) : '';
  });
};

/**
 * Converts a local image path to a base64 data URI so it renders inside a
 * Puppeteer page without needing a network fetch.
 * Only used in local/development when template images are on disk.
 */
const toDataUri = async (absoluteImagePath) => {
  const fs = require('fs/promises');
  const path = require('path');
  const ext = path.extname(absoluteImagePath).toLowerCase();
  const mimeMap = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
  };
  const mime = mimeMap[ext] || 'image/png';
  const fileBuffer = await fs.readFile(absoluteImagePath);
  return `data:${mime};base64,${fileBuffer.toString('base64')}`;
};

const formatCompletionDate = (dateValue) => {
  const date = dateValue ? new Date(dateValue) : new Date();
  if (Number.isNaN(date.getTime())) return new Date().toLocaleDateString();
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });
};

/**
 * Generates a unique certificate number: CERT-YYYYMMDD-XXXXXX
 */
const buildCertificateNumber = () => {
  const datePrefix = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const suffix = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `CERT-${datePrefix}-${suffix}`;
};

// ---------------------------------------------------------------------------
// Puppeteer helpers
// ---------------------------------------------------------------------------

/**
 * Launches a Puppeteer browser instance with production-safe flags.
 */
const launchBrowser = async () => {
  return puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage', // Prevents crashes in low-memory containers (Railway)
      '--disable-gpu',
      '--no-zygote',
    ],
  });
};

/**
 * Generates a PDF from HTML and returns it as a Buffer (NOT written to disk).
 *
 * @param {object} browser - Puppeteer browser instance
 * @param {string} html    - Complete HTML string to render
 * @returns {Promise<Buffer>} PDF content as a Buffer
 */
const generatePdfBuffer = async (browser, html) => {
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const buffer = await page.pdf({
      format: 'A4',
      landscape: true,
      printBackground: true,
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
    });
    return Buffer.from(buffer);
  } finally {
    await page.close();
  }
};

/**
 * Generates a PDF from HTML and uploads it to cloud storage.
 * Returns the public URL of the stored PDF.
 *
 * @param {object} browser          - Puppeteer browser instance
 * @param {string} html             - Complete HTML string
 * @param {string} certificateNumber - Unique certificate identifier (used as storage key)
 * @returns {Promise<{url: string, key: string}>}
 */
const generateAndUploadCertificate = async (browser, html, certificateNumber) => {
  const pdfBuffer = await generatePdfBuffer(browser, html);

  const key = `certificates/${certificateNumber}.pdf`;
  const url = await uploadFile({
    body: pdfBuffer,
    key,
    mimeType: 'application/pdf',
    cacheControl: 'public, max-age=31536000',
  });

  return { url, key };
};

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  defaultHtmlTemplate,
  renderTemplate,
  toDataUri,
  formatCompletionDate,
  buildCertificateNumber,
  launchBrowser,
  generatePdfBuffer,
  generateAndUploadCertificate,
};
