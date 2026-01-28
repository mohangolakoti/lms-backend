const express = require('express');
const router = express.Router();
const {
  getDashboard,
  getCourses,
  createCourse,
  updateCourse,
  addModule,
  updateModule,
  deleteModule,
  addLesson,
  updateLesson,
  deleteLesson,
  createAssessment,
  getAssessments,
  getCourseProgress,
  getSubmissions,
  gradeSubmission,
} = require('../controllers/instructorController');
const { protect, authorize } = require('../middleware/auth');
const { validate } = require('../middleware/validation');
const { body } = require('express-validator');

// All routes require authentication and instructor role
router.use(protect);
router.use(authorize('instructor', 'admin')); // Admin can also access instructor routes

/**
 * @swagger
 * /api/instructors/dashboard:
 *   get:
 *     summary: Get instructor dashboard
 *     tags: [Instructors]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Instructor dashboard data
 */
router.get('/dashboard', getDashboard);

/**
 * @swagger
 * /api/instructors/courses:
 *   get:
 *     summary: Get instructor's courses
 *     tags: [Instructors]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of instructor's courses
 *   post:
 *     summary: Create a new course
 *     tags: [Instructors]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - title
 *               - description
 *               - term
 *               - level
 *             properties:
 *               title:
 *                 type: string
 *               description:
 *                 type: string
 *               term:
 *                 type: string
 *                 enum: [longTerm, shortTerm, both]
 *               level:
 *                 type: string
 *                 enum: [Beginner, Intermediate, Advanced]
 *     responses:
 *       201:
 *         description: Course created successfully
 */
router.get('/courses', getCourses);
router.post('/courses', [
  body('title').notEmpty().withMessage('Title is required'),
  body('description').notEmpty().withMessage('Description is required'),
  body('term').isIn(['longTerm', 'shortTerm', 'both']).withMessage('Invalid term'),
  body('level').isIn(['Beginner', 'Intermediate', 'Advanced']).withMessage('Invalid level'),
], validate, createCourse);

/**
 * @swagger
 * /api/instructors/courses/{id}:
 *   put:
 *     summary: Update course
 *     tags: [Instructors]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Course updated successfully
 */
router.put('/courses/:id', updateCourse);

/**
 * @swagger
 * /api/instructors/courses/{id}/modules:
 *   post:
 *     summary: Add module to course
 *     tags: [Instructors]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
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
 *               - title
 *             properties:
 *               title:
 *                 type: string
 *               order:
 *                 type: number
 *     responses:
 *       201:
 *         description: Module added successfully
 */
router.post('/courses/:id/modules', [
  body('title').notEmpty().withMessage('Module title is required'),
], validate, addModule);

/**
 * @swagger
 * /api/instructors/courses/{courseId}/modules/{moduleId}:
 *   put:
 *     summary: Update module
 *     tags: [Instructors]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: courseId
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: moduleId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Module updated successfully
 *   delete:
 *     summary: Delete module
 *     tags: [Instructors]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: courseId
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: moduleId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Module deleted successfully
 */
router.put('/courses/:courseId/modules/:moduleId', updateModule);
router.delete('/courses/:courseId/modules/:moduleId', deleteModule);

/**
 * @swagger
 * /api/instructors/courses/{courseId}/modules/{moduleId}/lessons:
 *   post:
 *     summary: Add lesson to module
 *     tags: [Instructors]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: courseId
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: moduleId
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
 *               - title
 *               - type
 *               - url
 *             properties:
 *               title:
 *                 type: string
 *               description:
 *                 type: string
 *               type:
 *                 type: string
 *                 enum: [pdf, video, quiz]
 *               url:
 *                 type: string
 *               durationSeconds:
 *                 type: number
 *               order:
 *                 type: number
 *     responses:
 *       201:
 *         description: Lesson added successfully
 */
router.post('/courses/:courseId/modules/:moduleId/lessons', [
  body('title').notEmpty().withMessage('Lesson title is required'),
  body('type').isIn(['pdf', 'video', 'quiz']).withMessage('Invalid lesson type'),
  body('url').notEmpty().withMessage('URL is required'),
], validate, addLesson);

/**
 * @swagger
 * /api/instructors/courses/{courseId}/modules/{moduleId}/lessons/{lessonId}:
 *   put:
 *     summary: Update lesson
 *     tags: [Instructors]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: courseId
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: moduleId
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: lessonId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Lesson updated successfully
 *   delete:
 *     summary: Delete lesson
 *     tags: [Instructors]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: courseId
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: moduleId
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: lessonId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Lesson deleted successfully
 */
router.put('/courses/:courseId/modules/:moduleId/lessons/:lessonId', updateLesson);
router.delete('/courses/:courseId/modules/:moduleId/lessons/:lessonId', deleteLesson);

/**
 * @swagger
 * /api/instructors/assessments:
 *   get:
 *     summary: Get assessments
 *     tags: [Instructors]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of assessments
 *   post:
 *     summary: Create assessment
 *     tags: [Instructors]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - courseId
 *               - title
 *               - questions
 *               - duration
 *               - totalMarks
 *               - passingMarks
 *             properties:
 *               courseId:
 *                 type: string
 *               moduleId:
 *                 type: string
 *               title:
 *                 type: string
 *               description:
 *                 type: string
 *               questions:
 *                 type: array
 *               duration:
 *                 type: number
 *               totalMarks:
 *                 type: number
 *               passingMarks:
 *                 type: number
 *     responses:
 *       201:
 *         description: Assessment created successfully
 */
router.post('/assessments', [
  body('courseId')
    .trim()
    .notEmpty().withMessage('Course ID is required')
    .isMongoId().withMessage('Invalid Course ID format'),
  body('title')
    .trim()
    .notEmpty().withMessage('Title is required'),
  body('questions')
    .isArray({ min: 1 }).withMessage('At least one question is required'),
  body('duration')
    .notEmpty().withMessage('Duration is required')
    .isNumeric().withMessage('Duration must be a number'),
  body('totalMarks')
    .notEmpty().withMessage('Total marks is required')
    .isNumeric().withMessage('Total marks must be a number'),
  body('passingMarks')
    .notEmpty().withMessage('Passing marks is required')
    .isNumeric().withMessage('Passing marks must be a number'),
], validate, createAssessment);
router.get('/assessments', getAssessments);

/**
 * @swagger
 * /api/instructors/courses/{courseId}/progress:
 *   get:
 *     summary: Get student progress for course
 *     tags: [Instructors]
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
 *         description: Student progress data
 */
router.get('/courses/:courseId/progress', getCourseProgress);

/**
 * @swagger
 * /api/instructors/assessments/{assessmentId}/submissions:
 *   get:
 *     summary: Get submissions for assessment
 *     tags: [Instructors]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: assessmentId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: List of submissions
 */
router.get('/assessments/:assessmentId/submissions', getSubmissions);

/**
 * @swagger
 * /api/instructors/submissions/{submissionId}/grade:
 *   put:
 *     summary: Grade submission
 *     tags: [Instructors]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: submissionId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               feedback:
 *                 type: string
 *     responses:
 *       200:
 *         description: Submission graded successfully
 */
router.put('/submissions/:submissionId/grade', gradeSubmission);

module.exports = router;

