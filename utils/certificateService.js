const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const puppeteer = require('puppeteer');

const uploadRoot = path.resolve(process.env.UPLOAD_PATH || './uploads');
const certificateDir = path.join(uploadRoot, 'certificates');
const templateDir = path.join(certificateDir, 'templates');
const pdfDir = path.join(certificateDir, 'pdfs');

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

const ensureCertificateDirectories = async () => {
  await fs.mkdir(templateDir, { recursive: true });
  await fs.mkdir(pdfDir, { recursive: true });
};

const toDataUri = async (absoluteImagePath) => {
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

const renderTemplate = (htmlTemplate, values) => {
  return htmlTemplate.replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (_, key) => {
    return values[key] !== undefined && values[key] !== null ? String(values[key]) : '';
  });
};

const formatCompletionDate = (dateValue) => {
  const date = dateValue ? new Date(dateValue) : new Date();
  if (Number.isNaN(date.getTime())) return new Date().toLocaleDateString();

  return date.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
};

const buildCertificateNumber = () => {
  const datePrefix = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const suffix = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `CERT-${datePrefix}-${suffix}`;
};

const buildPdfAbsolutePath = (certificateNumber) => {
  return path.join(pdfDir, `${certificateNumber}.pdf`);
};

const toRelativeUploadPath = (absolutePath) => {
  const normalized = path.normalize(absolutePath);
  const relative = path.relative(uploadRoot, normalized);
  return relative.split(path.sep).join('/');
};

const launchBrowser = async () => {
  return puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
};

const generatePdfFromHtml = async (browser, html, outputPath) => {
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: 'networkidle0' });
    await page.pdf({
      path: outputPath,
      format: 'A4',
      landscape: true,
      printBackground: true,
      margin: {
        top: '0',
        right: '0',
        bottom: '0',
        left: '0',
      },
    });
  } finally {
    await page.close();
  }
};

module.exports = {
  defaultHtmlTemplate,
  uploadRoot,
  ensureCertificateDirectories,
  toDataUri,
  renderTemplate,
  formatCompletionDate,
  buildCertificateNumber,
  buildPdfAbsolutePath,
  toRelativeUploadPath,
  launchBrowser,
  generatePdfFromHtml,
};
