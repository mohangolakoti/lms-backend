const mongoose = require('mongoose');

const lessonNoteSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    courseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Course',
      required: true,
    },
    lessonId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },
    content: {
      type: String,
      default: '',
      maxlength: 5000,
    },
  },
  { timestamps: true }
);

lessonNoteSchema.index({ userId: 1, lessonId: 1 }, { unique: true });
// Compound index for fetching all notes in a course for a user
lessonNoteSchema.index({ userId: 1, courseId: 1 });

module.exports = mongoose.model('LessonNote', lessonNoteSchema);
