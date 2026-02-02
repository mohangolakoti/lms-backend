const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Please add a name'],
    trim: true,
  },
  email: {
    type: String,
    required: [true, 'Please add an email'],
    unique: true,
    lowercase: true,
    trim: true,
    match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Please add a valid email'],
  },
  password: {
    type: String,
    required: [true, 'Please add a password'],
    minlength: 6,
    select: false,
  },
  mobile: {
    type: String,
    trim: true,
  },
  role: {
    type: String,
    enum: ['admin', 'instructor', 'student'],
    default: 'student',
  },
  status: {
    type: String,
    enum: ['active', 'blocked'],
    default: 'active',
  },
  batch: {
    type: String,
    enum: ['longTerm', 'shortTerm'],
    required: function() {
      return this.role === 'student';
    },
  },
  approvalStatus: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending',
    required: function() {
      return this.role === 'student';
    },
    index: true,
  },
  batchId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Batch',
    required: function() {
      return this.role === 'student';
    },
    index: true,
  },
  avatarUrl: {
    type: String,
    default: '',
  },
  externalProfiles: {
    leetcode: { type: String, default: '' },
    hackerrank: { type: String, default: '' },
    github: { type: String, default: '' },
  },
  lastLogin: {
    type: Date,
  },
  emailVerified: {
    type: Boolean,
    default: false,
  },
  emailVerificationToken: {
    type: String,
  },
  passwordResetToken: {
    type: String,
  },
  passwordResetExpires: {
    type: Date,
  },
  approvalHistory: [{
    status: { type: String, enum: ['pending', 'approved', 'rejected'] },
    changedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    changedAt: { type: Date, default: Date.now },
    reason: String,
  }],
}, {
  timestamps: true,
});

// Create compound indexes
userSchema.index({ role: 1, status: 1 });
userSchema.index({ email: 1 });
userSchema.index({ batchId: 1, approvalStatus: 1 });
userSchema.index({ createdAt: -1 });

// Encrypt password before saving
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) {
    return next();
  }
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// Match user entered password to hashed password in database
userSchema.methods.matchPassword = async function(enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

// Approve user with audit trail
userSchema.methods.approveUser = async function(approvedBy) {
  if (this.role !== 'student') {
    throw new Error('Only students can be approved');
  }

  if (this.approvalStatus === 'approved') {
    throw new Error('User is already approved');
  }

  this.approvalStatus = 'approved';
  this.approvalHistory.push({
    status: 'approved',
    changedBy: approvedBy,
    changedAt: new Date(),
  });

  return this.save();
};

// Reject user with audit trail
userSchema.methods.rejectUser = async function(reason, rejectedBy) {
  if (this.role !== 'student') {
    throw new Error('Only students can be rejected');
  }

  if (this.approvalStatus === 'rejected') {
    throw new Error('User is already rejected');
  }

  this.approvalStatus = 'rejected';
  this.approvalHistory.push({
    status: 'rejected',
    changedBy: rejectedBy,
    changedAt: new Date(),
    reason: reason || 'No reason provided',
  });

  return this.save();
};

// Get approval history
userSchema.methods.getApprovalHistory = function() {
  return this.approvalHistory || [];
};

module.exports = mongoose.model('User', userSchema);


