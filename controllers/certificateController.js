const fs = require('fs/promises');
const path = require('path');
const mongoose = require('mongoose');
const crypto = require('crypto');
const User = require('../models/User');
const Batch = require('../models/Batch');
const Certificate = require('../models/Certificate');
const CertificateTemplate = require('../models/CertificateTemplate');
const CertificateJob = require('../models/CertificateJob');
const PaginationHelper = require('../utils/paginationHelper');
const ResponseHandler = require('../utils/responseHandler');
const logger = require('../utils/logger');
const { setProcessor, enqueue } = require('../utils/certificateQueue');
const { logAdminAction } = require('../utils/adminAudit');
const { ValidationError, NotFoundError, ForbiddenError } = require('../utils/errors');
const {
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
} = require('../utils/certificateService');

const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

const normalizeMode = (mode) => {
  if (!mode) return 'batch';
  return String(mode).toLowerCase() === 'individual' ? 'individual' : 'batch';
};

const validateGenerationInput = ({ mode, batchId, studentId, templateId, certificateName, duration }) => {
  if (!templateId || !isValidObjectId(templateId)) {
    throw new ValidationError('templateId must be a valid ObjectId');
  }

  if (!certificateName || !String(certificateName).trim()) {
    throw new ValidationError('certificate_name is required');
  }

  if (!duration || !String(duration).trim()) {
    throw new ValidationError('duration_text is required');
  }

  if (mode === 'batch') {
    if (!batchId || !isValidObjectId(batchId)) {
      throw new ValidationError('batchId must be a valid ObjectId in batch mode');
    }
  }

  if (mode === 'individual') {
    if (!studentId || !isValidObjectId(studentId)) {
      throw new ValidationError('studentId must be a valid ObjectId in individual mode');
    }
  }
};

const getStudentQuery = ({ mode, batchId, studentId }) => {
  const baseQuery = {
    role: 'student',
    status: 'active',
    approvalStatus: 'approved',
  };

  if (mode === 'individual') {
    return { ...baseQuery, _id: studentId };
  }

  return { ...baseQuery, batchId };
};

const fetchBatchNameMap = async (students) => {
  const batchIds = [...new Set(students.map((student) => student.batchId?.toString()).filter(Boolean))];
  if (!batchIds.length) return new Map();

  const batches = await Batch.find({ _id: { $in: batchIds } }).select('_id name').lean();
  return new Map(batches.map((batch) => [batch._id.toString(), batch.name]));
};

const buildRenderValues = ({ student, batchName, certificateName, durationText, completionDateText, certificateNumber, backgroundDataUri }) => ({
  student_name: student.name,
  certificate_name: certificateName,
  batch_name: batchName || 'Batch',
  duration: durationText,
  completion_date: completionDateText,
  certificate_id: certificateNumber,
  background_image: backgroundDataUri,
  // Backward-compatible fallback keys for existing custom templates.
  course_name: certificateName,
  instructor_name: '',
});

const generateCertificateForStudent = async ({
  student,
  template,
  backgroundDataUri,
  certificateName,
  durationText,
  completionDate,
  batchName,
  forceRegenerate,
  browser,
}) => {
  const existingCertificate = await Certificate.findOne({
    studentId: student._id,
    batchId: student.batchId,
    certificateName,
  });

  if (existingCertificate && !forceRegenerate) {
    return {
      skipped: true,
      reason: 'Certificate already exists',
      studentId: student._id,
      studentName: student.name,
    };
  }

  const certificateNumber = existingCertificate?.certificateNumber || buildCertificateNumber();
  const pdfAbsolutePath = buildPdfAbsolutePath(certificateNumber);

  const html = renderTemplate(template.htmlTemplate || defaultHtmlTemplate, buildRenderValues({
    student,
    batchName,
    certificateName,
    durationText,
    completionDateText: formatCompletionDate(completionDate),
    certificateNumber,
    backgroundDataUri,
  }));

  await generatePdfFromHtml(browser, html, pdfAbsolutePath);

  const relativePdfPath = toRelativeUploadPath(pdfAbsolutePath);

  const certificateData = {
    studentId: student._id,
    batchId: student.batchId,
    certificateName,
    duration: durationText,
    completionDate,
    templateId: template._id,
    certificateNumber,
    certificateUrl: `/api/certificates/download/${certificateNumber}`,
    filePath: relativePdfPath,
    issuedAt: new Date(),
  };

  const certificate = existingCertificate
    ? await Certificate.findByIdAndUpdate(existingCertificate._id, certificateData, { new: true })
    : await Certificate.create(certificateData);

  return {
    skipped: false,
    certificate,
    studentId: student._id,
    studentName: student.name,
  };
};

const deleteUploadedFileIfExists = async (filePath) => {
  if (!filePath) return;
  try {
    await fs.unlink(filePath);
  } catch (error) {
    // Ignore cleanup failures for non-existing files.
  }
};

// @desc    Create certificate template
// @route   POST /api/certificates/templates
// @access  Private/Admin
exports.createTemplate = async (req, res, next) => {
  try {
    const { name, htmlTemplate } = req.body;

    if (!name || !name.trim()) {
      throw new ValidationError('Template name is required');
    }

    if (!req.file) {
      throw new ValidationError('Template background image is required');
    }

    await ensureCertificateDirectories();

    const absoluteBackgroundPath = req.file.path;
    const backgroundImage = toRelativeUploadPath(absoluteBackgroundPath);

    const template = await CertificateTemplate.create({
      name: name.trim(),
      backgroundImage,
      htmlTemplate: htmlTemplate && htmlTemplate.trim() ? htmlTemplate : defaultHtmlTemplate,
    });

    return ResponseHandler.created(res, template, 'Certificate template created successfully');
  } catch (error) {
    if (req.file?.path) {
      await deleteUploadedFileIfExists(req.file.path);
    }
    next(error);
  }
};

// @desc    List certificate templates
// @route   GET /api/certificates/templates
// @access  Private/Admin
exports.getTemplates = async (req, res, next) => {
  try {
    const templates = await CertificateTemplate.find().sort({ createdAt: -1 }).lean();
    return ResponseHandler.success(res, templates);
  } catch (error) {
    next(error);
  }
};

// @desc    Preview certificate generation payload
// @route   POST /api/certificates/preview
// @access  Private/Admin
exports.previewCertificate = async (req, res, next) => {
  try {
    const {
      mode,
      batchId,
      studentId,
      templateId,
      certificateName,
      durationText,
      completionDate,
    } = req.body;

    const normalizedMode = normalizeMode(mode);
    validateGenerationInput({
      mode: normalizedMode,
      batchId,
      studentId,
      templateId,
      certificateName,
      duration: durationText,
    });

    await ensureCertificateDirectories();

    const template = await CertificateTemplate.findById(templateId).lean();
    if (!template) throw new NotFoundError('Certificate template');

    const students = await User.find(getStudentQuery({ mode: normalizedMode, batchId, studentId }))
      .select('_id name batchId')
      .lean();

    if (!students.length) {
      throw new NotFoundError('Eligible student');
    }

    const sampleStudent = students[0];
    const batchMap = await fetchBatchNameMap(students);

    const backgroundAbsolutePath = path.join(uploadRoot, template.backgroundImage);
    const backgroundDataUri = await toDataUri(backgroundAbsolutePath);

    const completionDateValue = completionDate ? new Date(completionDate) : new Date();
    const sampleCertificateNumber = buildCertificateNumber();
    const renderedHtml = renderTemplate(template.htmlTemplate || defaultHtmlTemplate, buildRenderValues({
      student: sampleStudent,
      batchName: batchMap.get(sampleStudent.batchId?.toString()),
      certificateName: String(certificateName).trim(),
      durationText: String(durationText).trim(),
      completionDateText: formatCompletionDate(completionDateValue),
      certificateNumber: sampleCertificateNumber,
      backgroundDataUri,
    }));

    return ResponseHandler.success(res, {
      mode: normalizedMode,
      sampleStudent: {
        id: sampleStudent._id,
        name: sampleStudent.name,
      },
      sampleCount: students.length,
      renderedHtml,
      note: normalizedMode === 'batch'
        ? 'Certificates will be generated for all students in batch'
        : 'Certificate will be generated for the selected student',
    });
  } catch (error) {
    next(error);
  }
};

const executeCertificateGeneration = async (payload) => {
  const {
    mode,
    batchId,
    studentId,
    templateId,
    certificateName,
    durationText,
    completionDate,
    forceRegenerate = false,
  } = payload;
  let browser;

  try {    
    const normalizedMode = normalizeMode(mode);
    const normalizedCertificateName = String(certificateName || '').trim();
    const normalizedDuration = String(durationText || '').trim();

    validateGenerationInput({
      mode: normalizedMode,
      batchId,
      studentId,
      templateId,
      certificateName: normalizedCertificateName,
      duration: normalizedDuration,
    });

    await ensureCertificateDirectories();

    const template = await CertificateTemplate.findById(templateId).lean();
    if (!template) throw new NotFoundError('Certificate template');

    const students = await User.find(getStudentQuery({ mode: normalizedMode, batchId, studentId }))
      .select('_id name email batchId')
      .lean();

    if (!students.length) {
      return {
        mode: normalizedMode,
        generatedCount: 0,
        skippedCount: 0,
        errorCount: 0,
        generatedCertificates: [],
        skippedStudents: [],
        errors: [],
      };
    }

    if (normalizedMode === 'batch') {
      const batchExists = await Batch.findById(batchId).lean();
      if (!batchExists) throw new NotFoundError('Batch');
    }

    const batchMap = await fetchBatchNameMap(students);

    const backgroundAbsolutePath = path.join(uploadRoot, template.backgroundImage);
    const backgroundDataUri = await toDataUri(backgroundAbsolutePath);
    browser = await launchBrowser();
    const completionDateValue = completionDate ? new Date(completionDate) : new Date();

    const generatedCertificates = [];
    const skippedStudents = [];
    const errors = [];

    for (const student of students) {
      try {
        const result = await generateCertificateForStudent({
          student,
          template,
          backgroundDataUri,
          certificateName: normalizedCertificateName,
          durationText: normalizedDuration,
          completionDate: completionDateValue,
          batchName: batchMap.get(student.batchId?.toString()),
          forceRegenerate,
          browser,
        });

        if (result.skipped) {
          skippedStudents.push({
            studentId: result.studentId,
            studentName: result.studentName,
            reason: result.reason,
          });
          continue;
        }

        generatedCertificates.push({
          id: result.certificate._id,
          certificateNumber: result.certificate.certificateNumber,
          studentId: result.studentId,
          studentName: result.studentName,
          certificateUrl: result.certificate.certificateUrl,
        });
      } catch (error) {
        errors.push({
          studentId: student._id,
          studentName: student.name,
          error: error.message,
        });
      }
    }

    return {
      mode: normalizedMode,
      batchId: normalizedMode === 'batch' ? batchId : undefined,
      studentId: normalizedMode === 'individual' ? studentId : undefined,
      certificateName: normalizedCertificateName,
      duration: normalizedDuration,
      generatedCount: generatedCertificates.length,
      skippedCount: skippedStudents.length,
      errorCount: errors.length,
      generatedCertificates,
      skippedStudents,
      errors,
    };
  } finally {
    if (browser) {
      await browser.close();
    }
  }
};

// @desc    Generate certificates (batch or individual)
// @route   POST /api/certificates/generate
// @access  Private/Admin
exports.generateCertificates = async (req, res, next) => {
  try {
    const payload = {
      mode: req.body.mode,
      batchId: req.body.batchId,
      studentId: req.body.studentId,
      templateId: req.body.templateId,
      certificateName: req.body.certificateName,
      durationText: req.body.durationText,
      completionDate: req.body.completionDate,
      forceRegenerate: req.body.forceRegenerate || false,
    };

    const idempotencyKey = crypto
      .createHash('sha256')
      .update(JSON.stringify({ requestedBy: req.user.id, payload }))
      .digest('hex');

    const existing = await CertificateJob.findOne({
      idempotencyKey,
      status: { $in: ['queued', 'processing', 'completed'] },
    }).lean();

    if (existing) {
      return ResponseHandler.success(res, {
        jobId: existing._id,
        status: existing.status,
        result: existing.result || null,
        idempotent: true,
      }, 'Using existing certificate generation job');
    }

    let job;
    try {
      job = await enqueue({
        requestedBy: req.user.id,
        payload,
        idempotencyKey,
        status: 'queued',
      });
    } catch (error) {
      if (error?.code === 11000) {
        const racedJob = await CertificateJob.findOne({ idempotencyKey }).lean();
        if (racedJob) {
          return ResponseHandler.success(res, {
            jobId: racedJob._id,
            status: racedJob.status,
            result: racedJob.result || null,
            idempotent: true,
          }, 'Using existing certificate generation job');
        }
      }
      throw error;
    }

    return ResponseHandler.success(res, {
      jobId: job._id,
      status: job.status,
      idempotent: false,
    }, 'Certificate generation queued');
  } catch (error) {
    next(error);
  }
};

// @desc    List certificate generation jobs
// @route   GET /api/certificates/jobs
// @access  Private/Admin
exports.getCertificateGenerationJobs = async (req, res, next) => {
  try {
    const { status, page = 1, limit = 10 } = req.query;
    const query = {};
    if (status) {
      query.status = status;
    }

    const total = await CertificateJob.countDocuments(query);
    const { page: pageNum, limit: pageLimit, skip } = PaginationHelper.getPaginationParams(page, limit);
    const jobs = await CertificateJob.find(query)
      .populate('requestedBy', 'name email')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(pageLimit)
      .lean();

    return ResponseHandler.success(res, {
      items: jobs,
      pagination: PaginationHelper.getPaginationMeta(total, pageNum, pageLimit),
    }, 'Certificate jobs fetched');
  } catch (error) {
    next(error);
  }
};

// @desc    Get certificate generation job status
// @route   GET /api/certificates/jobs/:jobId
// @access  Private/Admin
exports.getCertificateGenerationJob = async (req, res, next) => {
  try {
    const job = await CertificateJob.findById(req.params.jobId).lean();
    if (!job) {
      throw new NotFoundError('Certificate generation job');
    }

    return ResponseHandler.success(res, {
      jobId: job._id,
      status: job.status,
      result: job.result,
      error: job.error,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
      createdAt: job.createdAt,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get certificates for logged-in student
// @route   GET /api/certificates/my
// @access  Private/Student
exports.getMyCertificates = async (req, res, next) => {
  try {
    const certificates = await Certificate.find({ studentId: req.user.id })
      .populate('batchId', 'name')
      .sort({ issuedAt: -1 })
      .lean();

    return ResponseHandler.success(res, certificates);
  } catch (error) {
    next(error);
  }
};

// @desc    Get certificates (admin)
// @route   GET /api/certificates/admin
// @access  Private/Admin
exports.getCertificatesForAdmin = async (req, res, next) => {
  try {
    const { batchId, studentId, certificateName, page = 1, limit = 20 } = req.query;
    const query = {};

    if (batchId) query.batchId = batchId;
    if (studentId) query.studentId = studentId;
    if (certificateName && String(certificateName).trim()) {
      query.certificateName = { $regex: String(certificateName).trim(), $options: 'i' };
    }

    const total = await Certificate.countDocuments(query);
    const { page: pageNum, limit: pageLimit, skip } = PaginationHelper.getPaginationParams(page, limit);

    const certificates = await Certificate.find(query)
      .populate('studentId', 'name email')
      .populate('batchId', 'name')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(pageLimit)
      .lean();

    return ResponseHandler.success(res, {
      items: certificates,
      pagination: PaginationHelper.getPaginationMeta(total, pageNum, pageLimit),
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Revoke certificate
// @route   PUT /api/certificates/admin/:certificateId/revoke
// @access  Private/Admin
exports.revokeCertificate = async (req, res, next) => {
  try {
    const { certificateId } = req.params;
    const { reason = '' } = req.body || {};

    const certificate = await Certificate.findById(certificateId);
    if (!certificate) {
      throw new NotFoundError('Certificate');
    }
    if (certificate.isRevoked) {
      throw new ValidationError('Certificate is already revoked');
    }

    certificate.isRevoked = true;
    certificate.revokedAt = new Date();
    certificate.revokedBy = req.user.id;
    certificate.revocationReason = reason || 'Revoked by admin';
    await certificate.save();

    await logAdminAction({
      action: 'certificate.revoked',
      actorId: req.user.id,
      entityType: 'certificate',
      entityId: certificate._id,
      metadata: { certificateNumber: certificate.certificateNumber, reason: certificate.revocationReason },
    });

    return ResponseHandler.success(res, certificate, 'Certificate revoked successfully');
  } catch (error) {
    next(error);
  }
};

// @desc    Download certificate PDF
// @route   GET /api/certificates/download/:certificateNumber
// @access  Private (student can download own, admin can download all)
exports.downloadCertificate = async (req, res, next) => {
  try {
    const { certificateNumber } = req.params;
    const certificate = await Certificate.findOne({ certificateNumber });

    if (!certificate) {
      throw new NotFoundError('Certificate');
    }

    if (req.user.role === 'student' && certificate.studentId.toString() !== req.user.id) {
      throw new ForbiddenError('You are not authorized to download this certificate');
    }

    const absolutePath = path.join(uploadRoot, certificate.filePath);

    try {
      await fs.access(absolutePath);
    } catch (error) {
      throw new NotFoundError('Certificate file');
    }

    return res.download(absolutePath, `${certificate.certificateNumber}.pdf`);
  } catch (error) {
    next(error);
  }
};

// @desc    Verify certificate details by certificate number
// @route   GET /api/certificates/verify/:certificateNumber
// @access  Public
exports.verifyCertificate = async (req, res, next) => {
  try {
    const { certificateNumber } = req.params;

    const certificate = await Certificate.findOne({ certificateNumber })
      .populate('studentId', 'name')
      .populate('courseId', 'title')
      .populate('batchId', 'name')
      .lean();

    if (!certificate) {
      return ResponseHandler.success(res, {
        valid: false,
        certificateNumber,
      }, 'Certificate not found');
    }

    return ResponseHandler.success(res, {
      valid: !certificate.isRevoked,
      certificateNumber: certificate.certificateNumber,
      studentName: certificate.studentId?.name || 'N/A',
      certificateName: certificate.certificateName,
      duration: certificate.duration,
      completionDate: certificate.completionDate,
      batchName: certificate.batchId?.name || 'N/A',
      issuedAt: certificate.issuedAt,
      revoked: certificate.isRevoked,
      revokedAt: certificate.revokedAt,
      revocationReason: certificate.revocationReason,
      verificationUrl: `/api/certificates/verify/${certificate.certificateNumber}`,
    });
  } catch (error) {
    next(error);
  }
};

setProcessor(async (payload) => {
  logger.event('certificate_job_started', { mode: payload.mode });
  const result = await executeCertificateGeneration(payload);
  logger.event('certificate_job_completed', {
    mode: payload.mode,
    generatedCount: result.generatedCount,
    skippedCount: result.skippedCount,
    errorCount: result.errorCount,
  });
  return result;
});
