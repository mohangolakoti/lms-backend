const mongoose = require('mongoose');

const courseInstructorSchema = new mongoose.Schema({
  course_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Course',
    required: true,
    index: true,
  },
  instructor_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  role: {
    type: String,
    enum: ['viewer', 'editor'],
    required: true,
    default: 'viewer',
  },
}, {
  collection: 'course_instructors',
  timestamps: { createdAt: 'created_at', updatedAt: false },
});

courseInstructorSchema.index({ course_id: 1, instructor_id: 1 }, { unique: true });
courseInstructorSchema.index({ instructor_id: 1, role: 1 });

module.exports = mongoose.model('CourseInstructor', courseInstructorSchema);
