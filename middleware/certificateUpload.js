const fs = require('fs');
const path = require('path');
const multer = require('multer');

const uploadRoot = path.resolve(process.env.UPLOAD_PATH || './uploads');
const templateDir = path.join(uploadRoot, 'certificates', 'templates');

fs.mkdirSync(templateDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, templateDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const safeExt = ext || '.png';
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `certificate-template-${unique}${safeExt}`);
  },
});

const imageFileFilter = (req, file, cb) => {
  if (!file.mimetype || !file.mimetype.startsWith('image/')) {
    return cb(new Error('Only image files are allowed for certificate backgrounds'));
  }

  cb(null, true);
};

const uploadCertificateTemplate = multer({
  storage,
  fileFilter: imageFileFilter,
  limits: {
    fileSize: Number(process.env.MAX_FILE_SIZE || 10 * 1024 * 1024),
  },
});

module.exports = {
  uploadCertificateTemplate,
};
