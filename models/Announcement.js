const mongoose = require('mongoose');

const announcementSchema = new mongoose.Schema({
  title: {
    type: String,
    required: [true, 'Please add a title'],
    trim: true,
  },
  message: {
    type: String,
    required: [true, 'Please add a message'],
  },
  targetType: {
    type: String,
    enum: ['global', 'batch'],
    required: true,
  },
  batchIds: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Batch',
    },
  ],
  deliveryChannels: {
    type: [String],
    enum: ['email', 'whatsapp', 'portal'],
    validate: {
      validator: function(v) {
        return v && v.length > 0;
      },
      message: 'At least one delivery channel is required',
    },
  },
  isDeleted: {
    type: Boolean,
    default: false,
    index: true,
  },
  deletedAt: {
    type: Date,
    default: null,
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
}, {
  timestamps: true,
});

// Compound indexes for query optimization
announcementSchema.index({ targetType: 1, isDeleted: 1 });
announcementSchema.index({ batchIds: 1, isDeleted: 1 });
announcementSchema.index({ createdAt: -1, isDeleted: 1 });
announcementSchema.index({ createdBy: 1, isDeleted: 1 });

// Query middleware to exclude soft-deleted announcements by default
announcementSchema.pre(/^find/, function(next) {
  if (this.options._recursed) {
    return next();
  }
  this.find({ isDeleted: { $ne: true } });
  next();
});

// Instance method to soft delete
announcementSchema.methods.softDelete = async function() {
  this.isDeleted = true;
  this.deletedAt = new Date();
  return this.save();
};

// Instance method to restore
announcementSchema.methods.restore = async function() {
  this.isDeleted = false;
  this.deletedAt = null;
  return this.save();
};

// Static method to get with soft-deleted
announcementSchema.statics.withDeleted = function() {
  return this.find().setOptions({ _recursed: true });
};

module.exports = mongoose.model('Announcement', announcementSchema);


