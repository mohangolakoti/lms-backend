const express = require('express');
const { body } = require('express-validator');
const { protect, authorize } = require('../middleware/auth');
const { validate } = require('../middleware/validation');
const { uploadCertificateTemplate } = require('../middleware/certificateUpload');
const {
  createTemplate,
  getTemplates,
  previewCertificate,
  generateCertificates,
  getMyCertificates,
  getCertificatesForAdmin,
  downloadCertificate,
  verifyCertificate,
} = require('../controllers/certificateController');

const router = express.Router();

router.get('/verify/:certificateNumber', verifyCertificate);

router.use(protect);

router.get('/download/:certificateNumber', authorize('admin', 'student'), downloadCertificate);
router.get('/my', authorize('student'), getMyCertificates);
router.get('/admin', authorize('admin'), getCertificatesForAdmin);

router.get('/templates', authorize('admin'), getTemplates);
router.post(
  '/templates',
  authorize('admin'),
  uploadCertificateTemplate.single('backgroundImage'),
  [
    body('name').trim().notEmpty().withMessage('Template name is required'),
    body('htmlTemplate').optional().isString().withMessage('htmlTemplate must be a string'),
  ],
  validate,
  createTemplate
);

router.post(
  '/preview',
  authorize('admin'),
  [
    body('mode').optional().isIn(['batch', 'individual']).withMessage('mode must be batch or individual'),
    body('batchId').optional().isMongoId().withMessage('batchId must be a valid ObjectId'),
    body('studentId').optional().isMongoId().withMessage('studentId must be a valid ObjectId'),
    body('templateId').isMongoId().withMessage('templateId must be a valid ObjectId'),
    body('certificateName').trim().notEmpty().withMessage('certificate_name is required'),
    body('durationText').trim().notEmpty().withMessage('duration_text is required'),
    body('completionDate').optional().isISO8601().withMessage('completionDate must be a valid ISO date'),
  ],
  validate,
  previewCertificate
);

router.post(
  '/generate',
  authorize('admin'),
  [
    body('mode').optional().isIn(['batch', 'individual']).withMessage('mode must be batch or individual'),
    body('batchId').optional().isMongoId().withMessage('batchId must be a valid ObjectId'),
    body('studentId').optional().isMongoId().withMessage('studentId must be a valid ObjectId'),
    body('templateId').isMongoId().withMessage('templateId must be a valid ObjectId'),
    body('certificateName').trim().notEmpty().withMessage('certificate_name is required'),
    body('durationText').trim().notEmpty().withMessage('duration_text is required'),
    body('completionDate').optional().isISO8601().withMessage('completionDate must be a valid ISO date'),
    body('forceRegenerate').optional().isBoolean().withMessage('forceRegenerate must be boolean'),
  ],
  validate,
  generateCertificates
);

module.exports = router;
