const mongoose = require('mongoose');

const lessonProgressSchema = new mongoose.Schema({
  lessonId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
  },
  completed: {
    type: Boolean,
    default: false,
  },
  lastWatchedSecond: {
    type: Number,
    default: 0,
  },
  completedAt: {
    type: Date,
  },
}, { _id: false });

const moduleProgressSchema = new mongoose.Schema({
  moduleId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
  },
  completedLessons: [{
    type: mongoose.Schema.Types.ObjectId,
  }],
  completionPercentage: {
    type: Number,
    default: 0,
  },
}, { _id: false });

const progressSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  courseId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Course',
    required: true,
  },
  moduleProgress: [moduleProgressSchema],
  lessonProgress: [lessonProgressSchema],
  totalTimeSpent: {
    type: Number, // in seconds
    default: 0,
  },
  overallCoursePercentage: {
    type: Number,
    default: 0,
  },
  lastAccessed: {
    type: Date,
    default: Date.now,
  },
  completed: {
    type: Boolean,
    default: false,
  },
  completedAt: {
    type: Date,
  },
}, {
  timestamps: true,
});

// Compound index for efficient queries
progressSchema.index({ userId: 1, courseId: 1 }, { unique: true });
progressSchema.index({ userId: 1 });
progressSchema.index({ courseId: 1 });

module.exports = mongoose.model('Progress', progressSchema);


