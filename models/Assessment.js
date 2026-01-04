const mongoose = require('mongoose');

const questionSchema = new mongoose.Schema({
  question: {
    type: String,
    required: true,
  },
  type: {
    type: String,
    enum: ['mcq', 'fill-in-the-blank', 'true-false', 'short-answer'],
    required: true,
  },
  options: [{
    type: String,
  }],
  correctAnswer: {
    type: mongoose.Schema.Types.Mixed,
    required: true,
  },
  marks: {
    type: Number,
    required: true,
    default: 1,
  },
  order: {
    type: Number,
    required: true,
  },
}, { _id: false });

const assessmentSchema = new mongoose.Schema({
  courseId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Course',
    required: true,
  },
  moduleId: {
    type: mongoose.Schema.Types.ObjectId,
    required: false,
  },
  title: {
    type: String,
    required: [true, 'Please add an assessment title'],
  },
  description: {
    type: String,
    default: '',
  },
  questions: [questionSchema],
  duration: {
    type: Number, // in minutes
    required: true,
  },
  totalMarks: {
    type: Number,
    required: true,
  },
  passingMarks: {
    type: Number,
    required: true,
  },
  startDate: {
    type: Date,
  },
  endDate: {
    type: Date,
  },
  visibility: {
    type: String,
    enum: ['published', 'draft'],
    default: 'draft',
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
}, {
  timestamps: true,
});

assessmentSchema.index({ courseId: 1 });
assessmentSchema.index({ moduleId: 1 });
assessmentSchema.index({ createdBy: 1 });

module.exports = mongoose.model('Assessment', assessmentSchema);


