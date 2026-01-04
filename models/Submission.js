const mongoose = require('mongoose');

const answerSchema = new mongoose.Schema({
  questionId: {
    type: Number,
    required: true,
  },
  answer: {
    type: mongoose.Schema.Types.Mixed,
    required: true,
  },
  isCorrect: {
    type: Boolean,
    default: false,
  },
  marksObtained: {
    type: Number,
    default: 0,
  },
}, { _id: false });

const submissionSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  assessmentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Assessment',
    required: true,
  },
  answers: [answerSchema],
  score: {
    type: Number,
    default: 0,
  },
  totalMarks: {
    type: Number,
    required: true,
  },
  percentage: {
    type: Number,
    default: 0,
  },
  passed: {
    type: Boolean,
    default: false,
  },
  timeTaken: {
    type: Number, // in seconds
    required: true,
  },
  submittedAt: {
    type: Date,
    default: Date.now,
  },
  gradedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  gradedAt: {
    type: Date,
  },
  feedback: {
    type: String,
    default: '',
  },
}, {
  timestamps: true,
});

// Compound index
submissionSchema.index({ userId: 1, assessmentId: 1 });
submissionSchema.index({ assessmentId: 1 });
submissionSchema.index({ userId: 1 });

module.exports = mongoose.model('Submission', submissionSchema);


