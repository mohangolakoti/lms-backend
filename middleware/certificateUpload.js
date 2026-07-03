const multer = require('multer');

/**
 * Multer middleware for certificate template image uploads.
 *
 * Uses memoryStorage() instead of diskStorage() so uploaded files are kept in
 * RAM as req.file.buffer and immediately streamed to Cloudflare R2 by the
 * certificate controller. This eliminates Railway's ephemeral disk dependency.
 *
 * The controller is responsible for calling storageService.uploadFile() with
 * req.file.buffer after validation.
 */

const ALLOWED_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
]);

const MAX_FILE_BYTES = parseInt(process.env.MAX_FILE_SIZE || String(5 * 1024 * 1024), 10); // 5 MB default

const imageFileFilter = (req, file, cb) => {
  if (!file.mimetype || !ALLOWED_MIME_TYPES.has(file.mimetype)) {
    return cb(new Error('Only PNG, JPEG, or WebP images are allowed for certificate backgrounds'));
  }
  cb(null, true);
};

const uploadCertificateTemplate = multer({
  storage: multer.memoryStorage(), // Buffer in RAM — no local disk writes
  fileFilter: imageFileFilter,
  limits: {
    fileSize: MAX_FILE_BYTES,
    files: 1,
  },
});

module.exports = { uploadCertificateTemplate };
