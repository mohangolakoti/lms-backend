const express = require('express');
const router = express.Router();
const {
  getDashboard,
  getCourses,
  getCourseDetails,
  getCourseResume,
  updateLessonProgress,
  getLessonNote,
  saveLessonNote,
  getAssessments,
  getAssessmentById,
  submitAssessment,
  getAnnouncements,
  markAnnouncementRead,
  getNotifications,
  getUnreadNotificationCount,
  markNotificationRead,
  markAllNotificationsRead,
  getNotificationPreferences,
  updateNotificationPreferences,
  getLearningPath,
  getLearningCalendar,
  getBookmarks,
  toggleBookmark,
  getProfile,
} = require('../controllers/studentController');
const { protect, authorize } = require('../middleware/auth');

router.use(protect);
router.use(authorize('student'));

router.get('/dashboard', getDashboard);
router.get('/learning-path', getLearningPath);
router.get('/calendar', getLearningCalendar);
router.get('/profile', getProfile);
router.get('/bookmarks', getBookmarks);
router.post('/bookmarks', toggleBookmark);

router.get('/courses', getCourses);
router.get('/courses/:courseId', getCourseDetails);
router.get('/courses/:courseId/resume', getCourseResume);
router.put('/courses/:courseId/lessons/:lessonId/progress', updateLessonProgress);
router.get('/courses/:courseId/lessons/:lessonId/note', getLessonNote);
router.put('/courses/:courseId/lessons/:lessonId/note', saveLessonNote);

router.get('/assessments', getAssessments);
router.get('/assessments/:assessmentId', getAssessmentById);
router.post('/assessments/:assessmentId/submit', submitAssessment);

router.get('/announcements', getAnnouncements);
router.put('/announcements/:announcementId/read', markAnnouncementRead);

router.get('/notifications/unread-count', getUnreadNotificationCount);
router.put('/notifications/read-all', markAllNotificationsRead);
router.get('/notifications/preferences', getNotificationPreferences);
router.put('/notifications/preferences', updateNotificationPreferences);
router.get('/notifications', getNotifications);
router.put('/notifications/:notificationId/read', markNotificationRead);

module.exports = router;
