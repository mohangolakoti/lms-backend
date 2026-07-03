const mongoose = require('mongoose');

const lessonBookmarkSchema = new mongoose.Schema(
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
    lessonTitle: {
      type: String,
      default: '',
    },
    courseTitle: {
      type: String,
      default: '',
    },
  },
  { timestamps: true }
);

lessonBookmarkSchema.index({ userId: 1, lessonId: 1 }, { unique: true });
// Compound index for fetching all bookmarks in a course for a user
lessonBookmarkSchema.index({ userId: 1, courseId: 1 });

module.exports = mongoose.model('LessonBookmark', lessonBookmarkSchema);
