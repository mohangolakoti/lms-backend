const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  type: {
    type: String,
    enum: ['announcement', 'assessment', 'course', 'grade', 'system'],
    required: true,
  },
  title: {
    type: String,
    required: true,
  },
  message: {
    type: String,
    required: true,
  },
  payload: {
    type: mongoose.Schema.Types.Mixed,
    default: {},
  },
  read: {
    type: Boolean,
    default: false,
  },
  readAt: {
    type: Date,
  },
}, {
  timestamps: true,
});

// Hot read path: fetch user's unread notifications sorted by date
notificationSchema.index({ userId: 1, read: 1, createdAt: -1 });
// Separate index for fetching all notifications for a user (read + unread)
notificationSchema.index({ userId: 1, createdAt: -1 });
// Announcement payload lookup (deduplication checks)
notificationSchema.index({ 'payload.announcementId': 1 });
// TTL: auto-expire notifications after 90 days to prevent unbounded growth
notificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

module.exports = mongoose.model('Notification', notificationSchema);


