const express = require('express');
const router = express.Router();
const {
  getDashboard,
  getCourses,
  getCourseDetails,
  updateLessonProgress,
  getAssessments,
  submitAssessment,
  getAnnouncements,
  getNotifications,
  markNotificationRead,
} = require('../controllers/studentController');
const { protect, authorize } = require('../middleware/auth');

// All routes require authentication and student role
router.use(protect);
router.use(authorize('student'));

/**
 * @swagger
 * /api/students/dashboard:
 *   get:
 *     summary: Get student dashboard
 *     tags: [Students]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Dashboard data with courses and metrics
 */
router.get('/dashboard', getDashboard);

/**
 * @swagger
 * /api/students/courses:
 *   get:
 *     summary: Get assigned courses
 *     tags: [Students]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of assigned courses
 */
router.get('/courses', getCourses);

/**
 * @swagger
 * /api/students/courses/{courseId}:
 *   get:
 *     summary: Get course details
 *     tags: [Students]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: courseId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Course details with progress
 */
router.get('/courses/:courseId', getCourseDetails);

/**
 * @swagger
 * /api/students/courses/{courseId}/lessons/{lessonId}/progress:
 *   put:
 *     summary: Update lesson progress
 *     tags: [Students]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: courseId
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: lessonId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               completed:
 *                 type: boolean
 *               lastWatchedSecond:
 *                 type: number
 *     responses:
 *       200:
 *         description: Progress updated successfully
 */
router.put('/courses/:courseId/lessons/:lessonId/progress', updateLessonProgress);

/**
 * @swagger
 * /api/students/assessments:
 *   get:
 *     summary: Get assessments
 *     tags: [Students]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of assessments
 */
router.get('/assessments', getAssessments);

/**
 * @swagger
 * /api/students/assessments/{assessmentId}/submit:
 *   post:
 *     summary: Submit assessment
 *     tags: [Students]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: assessmentId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - answers
 *               - timeTaken
 *             properties:
 *               answers:
 *                 type: array
 *                 items:
 *                   type: object
 *               timeTaken:
 *                 type: number
 *     responses:
 *       201:
 *         description: Assessment submitted successfully
 */
router.post('/assessments/:assessmentId/submit', submitAssessment);

/**
 * @swagger
 * /api/students/announcements:
 *   get:
 *     summary: Get announcements
 *     tags: [Students]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of announcements
 */
router.get('/announcements', getAnnouncements);

/**
 * @swagger
 * /api/students/notifications:
 *   get:
 *     summary: Get notifications
 *     tags: [Students]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: read
 *         schema:
 *           type: boolean
 *     responses:
 *       200:
 *         description: List of notifications
 */
router.get('/notifications', getNotifications);

/**
 * @swagger
 * /api/students/notifications/{notificationId}/read:
 *   put:
 *     summary: Mark notification as read
 *     tags: [Students]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: notificationId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Notification marked as read
 */
router.put('/notifications/:notificationId/read', markNotificationRead);

module.exports = router;


