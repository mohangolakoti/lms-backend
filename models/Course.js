const mongoose = require('mongoose');

const lessonSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
  },
  description: {
    type: String,
    default: '',
  },
  type: {
    type: String,
    enum: ['pdf', 'video', 'quiz'],
    required: true,
  },
  url: {
    type: String,
    required: true,
  },
  durationSeconds: {
    type: Number,
    default: 0,
  },
  resources: [{
    type: String,
  }],
  order: {
    type: Number,
    required: true,
  },
}, { timestamps: true });

const moduleSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
  },
  order: {
    type: Number,
    required: true,
  },
  lessons: [lessonSchema],
}, { timestamps: true });

const courseSchema = new mongoose.Schema({
  title: {
    type: String,
    required: [true, 'Please add a course title'],
    trim: true,
  },
  description: {
    type: String,
    required: [true, 'Please add a course description'],
  },
  term: {
    type: String,
    enum: ['longTerm', 'shortTerm', 'both'],
    required: [true, 'Please specify term'],
  },
  level: {
    type: String,
    enum: ['Beginner', 'Intermediate', 'Advanced'],
    required: [true, 'Please specify level'],
  },
  thumbnailUrl: {
    type: String,
    default: '',
  },
  modules: [moduleSchema],
  visibility: {
    type: String,
    enum: ['published', 'draft'],
    default: 'draft',
  },
  instructorId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Please assign an instructor'],
  },
}, {
  timestamps: true,
});

// Index for efficient queries
courseSchema.index({ term: 1, visibility: 1 });
courseSchema.index({ instructorId: 1 });

module.exports = mongoose.model('Course', courseSchema);


