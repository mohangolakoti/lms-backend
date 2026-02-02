const express = require('express');
const router = express.Router();
const {
  getDashboard,
  getStudents,
  getStudent,
  updateStudentStatus,
  getPendingStudents,
  approveStudent,
  rejectStudent,
  updateAcademicInfo,
  createCourse,
  updateCourse,
  deleteCourse,
  getCourses,
  getCourseAnalytics,
  createAnnouncement,
  getInstructors,
} = require('../controllers/adminController');
const { protect, authorize } = require('../middleware/auth');
const { validate } = require('../middleware/validation');
const { body } = require('express-validator');

// All routes require authentication and admin role
router.use(protect);
router.use(authorize('admin'));

/**
 * @swagger
 * /api/admin/dashboard:
 *   get:
 *     summary: Get admin dashboard stats
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Dashboard statistics
 */
router.get('/dashboard', getDashboard);

/**
 * @swagger
 * /api/admin/students:
 *   get:
 *     summary: Get all students
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [active, blocked]
 *       - in: query
 *         name: batch
 *         schema:
 *           type: string
 *           enum: [longTerm, shortTerm]
 *       - in: query
 *         name: approvalStatus
 *         schema:
 *           type: string
 *           enum: [pending, approved, rejected]
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: List of students
 */
router.get('/students', getStudents);

/**
 * @swagger
 * /api/admin/students/{id}:
 *   get:
 *     summary: Get student by ID
 *     tags: [Admin]
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
 *         description: Student details with progress
 */
router.get('/students/:id', getStudent);

/**
 * @swagger
 * /api/admin/students/{id}/status:
 *   put:
 *     summary: Update student status
 *     tags: [Admin]
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
 *               - status
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [active, blocked]
 *     responses:
 *       200:
 *         description: Status updated successfully
 */
router.put('/students/:id/status', [
  body('status').isIn(['active', 'blocked']).withMessage('Status must be active or blocked'),
], validate, updateStudentStatus);

/**
 * @swagger
 * /api/admin/students/approval/pending:
 *   get:
 *     summary: Get pending student approvals
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of pending students
 */
router.get('/students/approval/pending', getPendingStudents);

/**
 * @swagger
 * /api/admin/students/{id}/approval/approve:
 *   put:
 *     summary: Approve student account
 *     tags: [Admin]
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
 *         description: Student account approved
 */
router.put('/students/:id/approval/approve', approveStudent);

/**
 * @swagger
 * /api/admin/students/{id}/approval/reject:
 *   put:
 *     summary: Reject student account
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               reason:
 *                 type: string
 *     responses:
 *       200:
 *         description: Student account rejected
 */
router.put('/students/:id/approval/reject', rejectStudent);

/**
 * @swagger
 * /api/admin/students/{id}/approve:
 *   put:
 *     summary: Approve student account (alternative path)
 *     tags: [Admin]
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
 *         description: Student account approved
 */
router.put('/students/:id/approve', approveStudent);

/**
 * @swagger
 * /api/admin/students/{id}/reject:
 *   put:
 *     summary: Reject student account (alternative path)
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               reason:
 *                 type: string
 *     responses:
 *       200:
 *         description: Student account rejected
 */
router.put('/students/:id/reject', rejectStudent);

/**
 * @swagger
 * /api/admin/students/{id}/update-academic:
 *   put:
 *     summary: Update student academic information (term and batch)
 *     tags: [Admin]
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
 *             properties:
 *               batch:
 *                 type: string
 *                 enum: [longTerm, shortTerm]
 *                 description: Student batch term
 *               batchId:
 *                 type: string
 *                 description: MongoDB ObjectId of the Batch
 *     responses:
 *       200:
 *         description: Student academic information updated
 */
router.put('/students/:id/update-academic', [
  body('batch')
    .optional()
    .isIn(['longTerm', 'shortTerm'])
    .withMessage('Batch term must be longTerm or shortTerm'),
  body('batchId')
    .optional()
    .isMongoId()
    .withMessage('Invalid batchId format'),
], validate, updateAcademicInfo);

/**
 * @swagger
 * /api/admin/courses:
 *   get:
 *     summary: Get all courses
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of all courses
 *   post:
 *     summary: Create a new course
 *     tags: [Admin]
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
 *               thumbnailUrl:
 *                 type: string
 *               instructorId:
 *                 type: string
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
 * /api/admin/courses/{id}:
 *   put:
 *     summary: Update course
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: Course updated successfully
 *   delete:
 *     summary: Delete course
 *     tags: [Admin]
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
 *         description: Course deleted successfully
 */
router.put('/courses/:id', updateCourse);
router.delete('/courses/:id', deleteCourse);

/**
 * @swagger
 * /api/admin/courses/{id}/analytics:
 *   get:
 *     summary: Get course analytics
 *     tags: [Admin]
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
 *         description: Course analytics data
 */
router.get('/courses/:id/analytics', getCourseAnalytics);

/**
 * @swagger
 * /api/admin/announcements:
 *   post:
 *     summary: Create announcement
 *     tags: [Admin]
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
 *               - message
 *               - target
 *             properties:
 *               title:
 *                 type: string
 *               message:
 *                 type: string
 *               target:
 *                 type: string
 *                 enum: [global, course]
 *               courseId:
 *                 type: string
 *               pinned:
 *                 type: boolean
 *     responses:
 *       201:
 *         description: Announcement created successfully
 */
router.post('/announcements', [
  body('title').notEmpty().withMessage('Title is required'),
  body('message').notEmpty().withMessage('Message is required'),
  body('target').isIn(['global', 'course']).withMessage('Target must be global or course'),
], validate, createAnnouncement);

/**
 * @swagger
 * /api/admin/instructors:
 *   get:
 *     summary: Get all instructors
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of instructors
 */
router.get('/instructors', getInstructors);

module.exports = router;

