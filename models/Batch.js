const mongoose = require('mongoose');

const batchSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Batch name is required'],
      unique: true,
      trim: true,
      minlength: [2, 'Batch name must be at least 2 characters'],
      maxlength: [50, 'Batch name cannot exceed 50 characters'],
      lowercase: true,
      index: true,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
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
  },
  {
    timestamps: true,
  }
);

// Compound index for common queries
batchSchema.index({ isActive: 1, isDeleted: 1 });
batchSchema.index({ createdAt: -1 });

// Query middleware to exclude soft-deleted batches by default
batchSchema.pre(/^find/, function(next) {
  if (this.options._recursed) {
    return next();
  }

  this.find({ isDeleted: { $ne: true } });
  next();
});

// Instance method to soft delete
batchSchema.methods.softDelete = async function() {
  this.isDeleted = true;
  this.deletedAt = new Date();
  
  // Auto-deactivate when deleting
  if (this.isActive) {
    this.isActive = false;
  }

  return this.save();
};

// Instance method to restore
batchSchema.methods.restore = async function() {
  this.isDeleted = false;
  this.deletedAt = null;
  return this.save();
};

// Static method to get with soft-deleted
batchSchema.statics.withDeleted = function() {
  return this.find().setOptions({ _recursed: true });
};

// Static method to get only soft-deleted
batchSchema.statics.onlyDeleted = function() {
  return this.find({ isDeleted: true }).setOptions({ _recursed: true });
};

module.exports = mongoose.model('Batch', batchSchema);

