const mongoose = require('mongoose');

const certificateTemplateSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Template name is required'],
      trim: true,
      maxlength: [120, 'Template name cannot exceed 120 characters'],
    },
    backgroundImage: {
      type: String,
      required: [true, 'Background image is required'],
      trim: true,
    },
    htmlTemplate: {
      type: String,
      required: [true, 'HTML template is required'],
    },
  },
  {
    timestamps: true,
    collection: 'certificate_templates',
  }
);

certificateTemplateSchema.index({ createdAt: -1 });

module.exports = mongoose.model('CertificateTemplate', certificateTemplateSchema);
