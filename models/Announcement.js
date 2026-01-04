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
  target: {
    type: String,
    enum: ['global', 'course'],
    required: true,
  },
  courseId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Course',
    required: function() {
      return this.target === 'course';
    },
  },
  pinned: {
    type: Boolean,
    default: false,
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
}, {
  timestamps: true,
});

announcementSchema.index({ target: 1, courseId: 1 });
announcementSchema.index({ pinned: -1, createdAt: -1 });
announcementSchema.index({ createdBy: 1 });

module.exports = mongoose.model('Announcement', announcementSchema);


