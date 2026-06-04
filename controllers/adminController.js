const Course = require('../models/Course');
const User = require('../models/User');
const Progress = require('../models/Progress');
const Assessment = require('../models/Assessment');
const Submission = require('../models/Submission');
const Announcement = require('../models/Announcement');
const Notification = require('../models/Notification');
const NotificationPreference = require('../models/NotificationPreference');
const Batch = require('../models/Batch');
const CourseInstructor = require('../models/CourseInstructor');
const AdminAuditLog = require('../models/AdminAuditLog');
const sendEmail = require('../utils/sendEmail');
const { sendBatchWhatsAppMessages } = require('../utils/whatsappService');
const logger = require('../utils/logger');
const {
  normalizeAssignments,
  buildPrimaryInstructorId,
  hasAtLeastOneEditor,
  syncCourseInstructors,
  getCourseAssignmentsMap,
} = require('../utils/courseInstructorService');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const PaginationHelper = require('../utils/paginationHelper');
const { logAdminAction } = require('../utils/adminAudit');

const DASHBOARD_CACHE_TTL_MS = 60 * 1000;
let dashboardCache = { data: null, expiresAt: 0 };

const validateInstructorAssignments = async (assignments = []) => {
  if (!assignments.length) {
    return 'At least one instructor must be assigned';
  }

  if (!hasAtLeastOneEditor(assignments)) {
    return 'At least one assigned instructor must have editor role';
  }

  const instructorIds = assignments.map((item) => item.instructorId);
  const instructors = await User.find({
    _id: { $in: instructorIds },
    role: 'instructor',
  }).select('_id');

  if (instructors.length !== assignments.length) {
    return 'One or more assigned instructors are invalid';
  }

  return null;
};

const validateCourseBatches = async (batchIds = []) => {
  if (!Array.isArray(batchIds) || batchIds.length === 0) {
    return 'At least one batch must be assigned';
  }

  const uniqueBatchIds = [...new Set(batchIds.map((batchId) => String(batchId)))];
  const existingBatches = await Batch.find({
    _id: { $in: uniqueBatchIds },
    isActive: true,
    isDeleted: false,
  }).select('_id');

  if (existingBatches.length !== uniqueBatchIds.length) {
    return 'One or more selected batches are invalid or inactive';
  }

  return null;
};

// @desc    Get admin dashboard stats
// @route   GET /api/admin/dashboard
// @access  Private/Admin
exports.getDashboard = async (req, res, next) => {
  try {
    if (dashboardCache.data && dashboardCache.expiresAt > Date.now()) {
      return res.status(200).json({
        success: true,
        data: dashboardCache.data,
        cache: { hit: true, expiresAt: new Date(dashboardCache.expiresAt).toISOString() },
      });
    }

    const totalStudents = await User.countDocuments({ role: 'student' });
    const activeStudents = await User.countDocuments({
      role: 'student',
      status: 'active',
      approvalStatus: 'approved',
      batchBlocked: { $ne: true },
    });
    const blockedStudents = await User.countDocuments({ role: 'student', status: 'blocked' });
    const totalInstructors = await User.countDocuments({ role: 'instructor' });
    const totalCourses = await Course.countDocuments();
    const publishedCourses = await Course.countDocuments({ visibility: 'published' });
    const draftCourses = await Course.countDocuments({ visibility: 'draft' });

    // Course completion stats
    const totalProgress = await Progress.countDocuments();
    const completedProgress = await Progress.countDocuments({ completed: true });

    // Student activity (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const activeStudentsRecent = await User.countDocuments({
      role: 'student',
      lastLogin: { $gte: thirtyDaysAgo },
    });

    // Total time spent across all students
    const timeSpentData = await Progress.aggregate([
      {
        $group: {
          _id: null,
          totalTimeSpent: { $sum: '$totalTimeSpent' },
        },
      },
    ]);
    const totalTimeSpent = timeSpentData[0]?.totalTimeSpent || 0;

    const payload = {
      users: {
        totalStudents,
        activeStudents,
        blockedStudents,
        totalInstructors,
      },
      courses: {
        totalCourses,
        publishedCourses,
        draftCourses,
      },
      progress: {
        totalProgress,
        completedProgress,
        completionRate: totalProgress > 0 ? (completedProgress / totalProgress) * 100 : 0,
      },
      activity: {
        activeStudentsRecent,
        totalTimeSpent: Math.round(totalTimeSpent / 3600), // Convert to hours
      },
    };

    dashboardCache = {
      data: payload,
      expiresAt: Date.now() + DASHBOARD_CACHE_TTL_MS,
    };

    res.status(200).json({
      success: true,
      data: payload,
      cache: { hit: false, expiresAt: new Date(dashboardCache.expiresAt).toISOString() },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get admin operational reports
// @route   GET /api/admin/reports/operational
// @access  Private/Admin
exports.getOperationalReports = async (req, res, next) => {
  try {
    const pendingApprovals = await User.countDocuments({ role: 'student', approvalStatus: 'pending' });
    const completedProgress = await Progress.countDocuments({ completed: true });
    const totalProgress = await Progress.countDocuments();
    const completionRate = totalProgress > 0 ? (completedProgress / totalProgress) * 100 : 0;
    const batchHealth = await Batch.aggregate([
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: 'batchId',
          as: 'students',
        },
      },
      {
        $project: {
          name: 1,
          isActive: 1,
          studentCount: {
            $size: {
              $filter: {
                input: '$students',
                as: 'student',
                cond: { $eq: ['$$student.role', 'student'] },
              },
            },
          },
        },
      },
      { $sort: { createdAt: -1 } },
      { $limit: 10 },
    ]);

    return res.status(200).json({
      success: true,
      data: {
        pendingApprovals,
        completionRate,
        batchHealth,
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get all students
// @route   GET /api/admin/students
// @access  Private/Admin
exports.getStudents = async (req, res, next) => {
  try {
    const { status, batch, search, approvalStatus, batchId, page = 1, limit = 20 } = req.query;
    const query = { role: 'student' };

    if (status) query.status = status;
    if (batch) query.batch = batch;
    if (batchId) query.batchId = batchId; // Filter by batch ID
    if (approvalStatus) query.approvalStatus = approvalStatus;
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
      ];
    }

    const total = await User.countDocuments(query);
    const { page: pageNum, limit: pageLimit, skip } = PaginationHelper.getPaginationParams(page, limit);

    const students = await User.find(query)
      .select('-password')
      .populate('batchId', 'name isActive')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(pageLimit);

    res.status(200).json({
      success: true,
      data: students,
      count: students.length,
      pagination: PaginationHelper.getPaginationMeta(total, pageNum, pageLimit),
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get student by ID
// @route   GET /api/admin/students/:id
// @access  Private/Admin
exports.getStudent = async (req, res, next) => {
  try {
    const student = await User.findById(req.params.id)
      .select('-password')
      .populate('approvalHistory.changedBy', 'name email role');

    if (!student || student.role !== 'student') {
      return res.status(404).json({
        success: false,
        error: 'Student not found',
      });
    }

    // Get student progress
    const progress = await Progress.find({ userId: student._id })
      .populate('courseId', 'title thumbnailUrl');

    res.status(200).json({
      success: true,
      data: {
        student,
        progress,
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Block/Unblock student
// @route   PUT /api/admin/students/:id/status
// @access  Private/Admin
exports.updateStudentStatus = async (req, res, next) => {
  try {
    const { status } = req.body;

    if (!['active', 'blocked'].includes(status)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid status',
      });
    }

    const student = await User.findById(req.params.id);

    if (!student || student.role !== 'student') {
      return res.status(404).json({
        success: false,
        error: 'Student not found',
      });
    }

    student.status = status;
    await student.save();
    await logAdminAction({
      action: 'student.status.updated',
      actorId: req.user.id,
      entityType: 'student',
      entityId: student._id,
      metadata: { status },
    });

    res.status(200).json({
      success: true,
      data: student,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Create course
// @route   POST /api/admin/courses
// @access  Private/Admin
exports.createCourse = async (req, res, next) => {
  try {
    const { batches, courseInstructors, instructorId, ...courseData } = req.body;

    // Validate batches
    const batchValidationError = await validateCourseBatches(batches);
    if (batchValidationError) {
      return res.status(400).json({
        success: false,
        error: batchValidationError,
      });
    }

    const normalizedAssignments = normalizeAssignments(courseInstructors, instructorId || req.user.id);
    const assignmentError = await validateInstructorAssignments(normalizedAssignments);

    if (assignmentError) {
      return res.status(400).json({
        success: false,
        error: assignmentError,
      });
    }

    const primaryInstructorId = buildPrimaryInstructorId(normalizedAssignments, req.user.id);

    const course = await Course.create({
      ...courseData,
      batches,
      instructorId: primaryInstructorId,
    });

    await syncCourseInstructors(course._id, normalizedAssignments);

    await course.populate('batches', 'name isActive');
    await course.populate('instructorId', 'name email');

    const assignmentsMap = await getCourseAssignmentsMap([course._id]);
    const responseCourse = {
      ...course.toObject(),
      courseInstructors: assignmentsMap.get(course._id.toString()) || [],
    };

    res.status(201).json({
      success: true,
      data: responseCourse,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Update course
// @route   PUT /api/admin/courses/:id
// @access  Private/Admin
exports.updateCourse = async (req, res, next) => {
  try {
    const { courseInstructors, instructorId, ...updateData } = req.body;
    if (updateData.batches !== undefined) {
      const batchValidationError = await validateCourseBatches(updateData.batches);
      if (batchValidationError) {
        return res.status(400).json({
          success: false,
          error: batchValidationError,
        });
      }
    }

    const course = await Course.findById(req.params.id);

    if (!course) {
      return res.status(404).json({
        success: false,
        error: 'Course not found',
      });
    }

    const normalizedAssignments = courseInstructors !== undefined || instructorId
      ? normalizeAssignments(courseInstructors, instructorId || course.instructorId)
      : null;

    if (normalizedAssignments) {
      const assignmentError = await validateInstructorAssignments(normalizedAssignments);

      if (assignmentError) {
        return res.status(400).json({
          success: false,
          error: assignmentError,
        });
      }

      updateData.instructorId = buildPrimaryInstructorId(normalizedAssignments, course.instructorId);
    }

    Object.assign(course, updateData);
    await course.save();

    if (normalizedAssignments) {
      await syncCourseInstructors(course._id, normalizedAssignments);
    }

    await course.populate('instructorId', 'name email');
    await course.populate('batches', 'name isActive');

    const assignmentsMap = await getCourseAssignmentsMap([course._id]);
    const responseCourse = {
      ...course.toObject(),
      courseInstructors: assignmentsMap.get(course._id.toString()) || [],
    };

    res.status(200).json({
      success: true,
      data: responseCourse,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Delete course
// @route   DELETE /api/admin/courses/:id
// @access  Private/Admin
exports.deleteCourse = async (req, res, next) => {
  try {
    const course = await Course.findById(req.params.id);

    if (!course) {
      return res.status(404).json({
        success: false,
        error: 'Course not found',
      });
    }

    await course.deleteOne();
    await CourseInstructor.deleteMany({ course_id: course._id });

    // Delete related data
    await Progress.deleteMany({ courseId: course._id });
    await Assessment.deleteMany({ courseId: course._id });
    await Announcement.deleteMany({ courseId: course._id });

    res.status(200).json({
      success: true,
      data: {},
      message: 'Course deleted successfully',
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get all courses
// @route   GET /api/admin/courses
// @access  Private/Admin
exports.getCourses = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, search, visibility, batchId } = req.query;
    const query = {};
    if (visibility) {
      query.visibility = visibility;
    }
    if (batchId) {
      query.batches = batchId;
    }
    if (search) {
      query.$or = [
        { title: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
      ];
    }

    const total = await Course.countDocuments(query);
    const { page: pageNum, limit: pageLimit, skip } = PaginationHelper.getPaginationParams(page, limit);

    const courses = await Course.find(query)
      .populate('instructorId', 'name email')
      .populate('batches', 'name isActive')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(pageLimit);

    const assignmentsMap = await getCourseAssignmentsMap(courses.map((course) => course._id));

    const responseCourses = courses.map((course) => {
      const courseObj = course.toObject();
      const assignments = assignmentsMap.get(course._id.toString()) || [];

      if (!assignments.length && course.instructorId) {
        assignments.push({
          instructorId: course.instructorId,
          role: 'editor',
          createdAt: course.createdAt,
        });
      }

      return {
        ...courseObj,
        courseInstructors: assignments,
      };
    });

    res.status(200).json({
      success: true,
      data: responseCourses,
      count: responseCourses.length,
      pagination: PaginationHelper.getPaginationMeta(total, pageNum, pageLimit),
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get course analytics
// @route   GET /api/admin/courses/:id/analytics
// @access  Private/Admin
exports.getCourseAnalytics = async (req, res, next) => {
  try {
    const { id, batchId } = req.params;

    const course = await Course.findById(id).populate('batches', 'name');
    if (!course) {
      return res.status(404).json({
        success: false,
        error: 'Course not found',
      });
    }

    // Get all progress entries for this course
    let progressData = await Progress.find({ courseId: id })
      .populate('userId', 'name email batch batchId');

    // Filter by batch if batchId param provided
    if (batchId) {
      const batchExists = course.batches.some(b => b._id.toString() === batchId);
      if (!batchExists) {
        return res.status(400).json({
          success: false,
          error: 'Batch not assigned to this course',
        });
      }

      progressData = progressData.filter(p => {
        return p.userId.batchId && p.userId.batchId.toString() === batchId;
      });
    }

    const totalStudents = progressData.length;
    const completedStudents = progressData.filter(p => p.completed).length;
    const avgCompletion = progressData.length > 0
      ? progressData.reduce((sum, p) => sum + p.overallCoursePercentage, 0) / progressData.length
      : 0;
    const totalTimeSpent = progressData.reduce((sum, p) => sum + (p.totalTimeSpent || 0), 0);

    // Module-wise completion
    const moduleStats = course.modules.map(module => {
      const moduleProgress = progressData.map(p => {
        const mp = p.moduleProgress.find(m => m.moduleId.toString() === module._id.toString());
        return mp ? mp.completionPercentage : 0;
      });

      const avgModuleCompletion = moduleProgress.length > 0
        ? moduleProgress.reduce((sum, p) => sum + p, 0) / moduleProgress.length
        : 0;

      return {
        moduleId: module._id,
        title: module.title,
        avgCompletion: Math.round(avgModuleCompletion * 100) / 100,
      };
    });

    res.status(200).json({
      success: true,
      data: {
        course: {
          title: course.title,
          totalModules: course.modules.length,
          totalLessons: course.modules.reduce((sum, m) => sum + m.lessons.length, 0),
          assignedBatches: course.batches.map(b => ({ id: b._id, name: b.name })),
        },
        students: {
          totalStudents,
          completedStudents,
          completionRate: totalStudents > 0 ? (completedStudents / totalStudents) * 100 : 0,
        },
        progress: {
          avgCompletion: Math.round(avgCompletion * 100) / 100,
          totalTimeSpent: Math.round(totalTimeSpent / 3600), // Convert to hours
        },
        moduleStats,
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Create announcement
// @route   POST /api/admin/announcements
// @access  Private/Admin
const scheduleAnnouncementDispatch = (announcementId, scheduledAt) => {
  const delayMs = Math.max(0, new Date(scheduledAt).getTime() - Date.now());
  const boundedDelay = Math.min(delayMs, 24 * 60 * 60 * 1000);
  setTimeout(async () => {
    try {
      const announcement = await Announcement.findById(announcementId).lean();
      if (!announcement || announcement.isDeleted) return;
      if (announcement.expiresAt && new Date(announcement.expiresAt) <= new Date()) {
        return;
      }

      let targetStudents = [];
      if (announcement.targetType === 'global') {
        targetStudents = await User.find({
          role: 'student',
          status: 'active',
          approvalStatus: 'approved',
        }).select('_id email name mobile batchId');
      } else {
        targetStudents = await User.find({
          role: 'student',
          status: 'active',
          approvalStatus: 'approved',
          batchId: { $in: announcement.batchIds || [] },
        }).select('_id email name mobile batchId');
      }

      await Announcement.findByIdAndUpdate(announcement._id, {
        $set: {
          deliveryState: 'sent',
          'deliveryStats.totalTargets': targetStudents.length,
        },
      });
      await handleAnnouncementDelivery(announcement, targetStudents, announcement.deliveryChannels || []);
    } catch (error) {
      await Announcement.findByIdAndUpdate(announcementId, {
        $set: { deliveryState: 'failed' },
      });
      logger.error('Scheduled announcement dispatch failed', { announcementId, error: error.message });
    }
  }, boundedDelay);
};

exports.createAnnouncement = async (req, res, next) => {
  try {
    const { title, message, targetType, batchIds, deliveryChannels, scheduledAt, expiresAt } = req.body;

    // Validation
    if (!deliveryChannels || deliveryChannels.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'At least one delivery channel must be selected',
      });
    }

    if (targetType === 'batch' && (!batchIds || batchIds.length === 0)) {
      return res.status(400).json({
        success: false,
        error: 'Batch IDs are required for batch-specific announcements',
      });
    }

    if (targetType === 'batch') {
      const uniqueBatchIds = [...new Set(batchIds.map((batchId) => String(batchId)))];
      const batchCount = await Batch.countDocuments({
        _id: { $in: uniqueBatchIds },
        isActive: true,
        isDeleted: false,
      });
      if (batchCount !== uniqueBatchIds.length) {
        return res.status(400).json({
          success: false,
          error: 'One or more selected batches are invalid or inactive',
        });
      }
    }

    if (targetType === 'global' && batchIds && batchIds.length > 0) {
      return res.status(400).json({
        success: false,
        error: 'Batch IDs must be empty for global announcements',
      });
    }

    const scheduledDate = scheduledAt ? new Date(scheduledAt) : null;
    const expiresDate = expiresAt ? new Date(expiresAt) : null;
    if (scheduledDate && Number.isNaN(scheduledDate.getTime())) {
      return res.status(400).json({ success: false, error: 'Invalid scheduledAt date' });
    }
    if (expiresDate && Number.isNaN(expiresDate.getTime())) {
      return res.status(400).json({ success: false, error: 'Invalid expiresAt date' });
    }
    if (scheduledDate && expiresDate && expiresDate <= scheduledDate) {
      return res.status(400).json({
        success: false,
        error: 'expiresAt must be later than scheduledAt',
      });
    }

    // Create announcement
    const announcement = await Announcement.create({
      title,
      message,
      targetType,
      batchIds: targetType === 'batch' ? batchIds : [],
      deliveryChannels,
      scheduledAt: scheduledDate,
      expiresAt: expiresDate,
      deliveryState: scheduledDate && scheduledDate > new Date() ? 'scheduled' : 'sent',
      createdBy: req.user.id,
      deliveryStats: {
        totalTargets: 0,
      },
    });
    await logAdminAction({
      action: 'announcement.created',
      actorId: req.user.id,
      entityType: 'announcement',
      entityId: announcement._id,
      metadata: {
        targetType,
        deliveryChannels,
        batchIds: targetType === 'batch' ? batchIds : [],
      },
    });

    // Determine target students based on targetType
    let targetStudents = [];

    if (targetType === 'global') {
      // Get all active, approved students
      targetStudents = await User.find({
        role: 'student',
        status: 'active',
        approvalStatus: 'approved',
      }).select('_id email name mobile batchId');
    } else if (targetType === 'batch') {
      // Get students in specified batches
      targetStudents = await User.find({
        role: 'student',
        status: 'active',
        approvalStatus: 'approved',
        batchId: { $in: batchIds },
      }).select('_id email name mobile batchId');
    }

    logger.info(`Announcement targeting ${targetStudents.length} students`);

    if (scheduledDate && scheduledDate > new Date()) {
      scheduleAnnouncementDispatch(announcement._id, scheduledDate);
    } else {
      await Announcement.findByIdAndUpdate(announcement._id, {
        $set: {
          'deliveryStats.totalTargets': targetStudents.length,
        },
      });

      // Process delivery channels asynchronously (non-blocking)
      // Do NOT await these - return success immediately after DB save
      handleAnnouncementDelivery(announcement, targetStudents, deliveryChannels).catch(
        error => logger.error('Error in announcement delivery:', error)
      );
    }

    // Populate references for response
    const populatedAnnouncement = await Announcement.findById(announcement._id)
      .populate('createdBy', 'name email')
      .populate('batchIds', 'name');

    res.status(201).json({
      success: true,
      data: populatedAnnouncement,
      message: scheduledDate && scheduledDate > new Date()
        ? 'Announcement scheduled successfully.'
        : 'Announcement created successfully. Notifications are being sent.',
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Handle async delivery of announcement through multiple channels
 * This runs in the background without blocking the HTTP response
 */
async function handleAnnouncementDelivery(announcement, targetStudents, deliveryChannels) {
  const channelHandlers = {
    portal: () => handlePortalDelivery(announcement, targetStudents),
    email: () => handleEmailDelivery(announcement, targetStudents),
    whatsapp: () => handleWhatsAppDelivery(announcement, targetStudents),
  };

  const selectedChannels = deliveryChannels.filter((channel) => channelHandlers[channel]);
  const results = await Promise.all(
    selectedChannels.map(async (channel) => {
      try {
        const result = await channelHandlers[channel]();
        return { channel, ok: true, result };
      } catch (error) {
        return { channel, ok: false, error };
      }
    })
  );

  const deliveryStats = {
    portal: { sent: 0, failed: 0, skipped_opt_out: 0, skipped_no_contact: 0 },
    email: { sent: 0, failed: 0, skipped_opt_out: 0, skipped_no_contact: 0 },
    whatsapp: { sent: 0, failed: 0, skipped_opt_out: 0, skipped_no_contact: 0 },
    totalTargets: targetStudents.length,
    updatedAt: new Date(),
  };

  results.forEach((entry) => {
    const { channel } = entry;
    if (!channel) return;

    if (!entry.ok) {
      logger.error(`Failed to deliver via ${channel}:`, entry.error);
      deliveryStats[channel] = {
        sent: 0,
        failed: targetStudents.length,
        skipped_opt_out: 0,
        skipped_no_contact: 0,
      };
    } else {
      logger.info(`Successfully handled ${channel} delivery:`, entry.result);
      deliveryStats[channel] = {
        sent: entry.result.sent || 0,
        failed: entry.result.failed || 0,
        skipped_opt_out: entry.result.skipped_opt_out || 0,
        skipped_no_contact: entry.result.skipped_no_contact || 0,
      };
    }
  });

  await Announcement.findByIdAndUpdate(announcement._id, {
    $set: {
      deliveryStats,
    },
  });
}

/**
 * Create portal notifications for each student
 * This is fast and can be done synchronously within batch operations
 */
async function handlePortalDelivery(announcement, targetStudents) {
  if (targetStudents.length === 0) {
    return { channel: 'portal', sent: 0, failed: 0, skipped_opt_out: 0, skipped_no_contact: 0 };
  }

  const preferences = await NotificationPreference.find({
    userId: { $in: targetStudents.map((student) => student._id) },
    'channels.portal': false,
  }).select('userId').lean();
  const optOutIds = new Set(preferences.map((item) => item.userId.toString()));
  const eligibleStudents = targetStudents.filter((student) => !optOutIds.has(student._id.toString()));
  const skippedOptOut = targetStudents.length - eligibleStudents.length;
  if (eligibleStudents.length === 0) {
    return { channel: 'portal', sent: 0, failed: 0, skipped_opt_out: skippedOptOut, skipped_no_contact: 0 };
  }

  const notifications = eligibleStudents.map(student => ({
    userId: student._id,
    type: 'announcement',
    title: announcement.title,
    message: announcement.message,
    payload: {
      announcementId: announcement._id,
      targetType: announcement.targetType,
    },
  }));

  await Notification.insertMany(notifications);
  logger.info(`Portal: Created ${notifications.length} notifications`);

  return {
    channel: 'portal',
    sent: notifications.length,
    failed: 0,
    skipped_opt_out: skippedOptOut,
    skipped_no_contact: 0,
  };
}

/**
 * Send emails asynchronously for scalability
 * Uses Promise.all for parallel email sending
 */
const EMAIL_CONCURRENCY = 5;
const EMAIL_MAX_RETRIES = 2;

const sendEmailWithRetry = async (student, announcement) => {
  let attempt = 0;
  while (attempt <= EMAIL_MAX_RETRIES) {
    try {
      await sendEmail({
        email: student.email,
        subject: `New Announcement: ${announcement.title}`,
        html: `
        <h2>${announcement.title}</h2>
        <p>Dear ${student.name},</p>
        <p>${announcement.message}</p>
        <p>Regards,<br>LMS Administration</p>
      `,
        message: announcement.message,
      });
      return true;
    } catch (error) {
      attempt += 1;
      if (attempt > EMAIL_MAX_RETRIES) {
        logger.warn(`Failed to send email to ${student.email}:`, error.message);
        return false;
      }
    }
  }
  return false;
};

const processInBatches = async (items, worker, concurrency = 5) => {
  if (!items.length) return [];
  const results = new Array(items.length);
  let cursor = 0;

  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  });

  await Promise.all(runners);
  return results;
};

async function handleEmailDelivery(announcement, targetStudents) {
  if (targetStudents.length === 0) {
    return { channel: 'email', sent: 0, failed: 0, skipped_opt_out: 0, skipped_no_contact: 0 };
  }

  const preferences = await NotificationPreference.find({
    userId: { $in: targetStudents.map((student) => student._id) },
    'channels.email': false,
  }).select('userId').lean();
  const optOutIds = new Set(preferences.map((item) => item.userId.toString()));
  const optedInStudents = targetStudents.filter((student) => !optOutIds.has(student._id.toString()));
  const contactableStudents = optedInStudents.filter((student) => student.email);
  const skippedOptOut = targetStudents.length - optedInStudents.length;
  const skippedNoContact = optedInStudents.length - contactableStudents.length;

  if (contactableStudents.length === 0) {
    return {
      channel: 'email',
      sent: 0,
      failed: 0,
      skipped_opt_out: skippedOptOut,
      skipped_no_contact: skippedNoContact,
    };
  }

  const emailResults = await processInBatches(
    contactableStudents,
    (student) => sendEmailWithRetry(student, announcement),
    EMAIL_CONCURRENCY
  );
  const successCount = emailResults.filter(Boolean).length;
  const failureCount = emailResults.length - successCount;

  logger.info(`Email: Sent to ${successCount}, Failed: ${failureCount}`);

  return {
    channel: 'email',
    sent: successCount,
    failed: failureCount,
    skipped_opt_out: skippedOptOut,
    skipped_no_contact: skippedNoContact,
  };
}

/**
 * Send WhatsApp messages asynchronously
 * Uses WhatsApp service for message delivery
 */
async function handleWhatsAppDelivery(announcement, targetStudents) {
  if (targetStudents.length === 0) {
    return { channel: 'whatsapp', sent: 0, failed: 0, skipped_opt_out: 0, skipped_no_contact: 0 };
  }

  // Filter students with mobile numbers
  const preferences = await NotificationPreference.find({
    userId: { $in: targetStudents.map((student) => student._id) },
    'channels.whatsapp': true,
  }).select('userId').lean();
  const optedInIds = new Set(preferences.map((item) => item.userId.toString()));
  const optedInStudents = targetStudents.filter((student) => optedInIds.has(student._id.toString()));
  const studentsWithPhone = optedInStudents.filter((student) => student.mobile);
  const skippedOptOut = targetStudents.length - optedInStudents.length;
  const skippedNoContact = optedInStudents.length - studentsWithPhone.length;

  if (studentsWithPhone.length === 0) {
    logger.info('WhatsApp: No students with phone numbers');
    return {
      channel: 'whatsapp',
      sent: 0,
      failed: 0,
      skipped_opt_out: skippedOptOut,
      skipped_no_contact: skippedNoContact,
    };
  }

  const messages = studentsWithPhone.map(student => ({
    phoneNumber: student.mobile,
    title: announcement.title,
    message: announcement.message,
  }));

  const result = await sendBatchWhatsAppMessages(messages);

  logger.info(`WhatsApp: Sent to ${result.successful}, Failed: ${result.failed}`);

  return {
    channel: 'whatsapp',
    sent: result.successful,
    failed: result.failed,
    skipped_opt_out: skippedOptOut,
    skipped_no_contact: skippedNoContact,
  };
}

// @desc    Get all announcements
// @route   GET /api/admin/announcements
// @access  Private/Admin
exports.getAnnouncements = async (req, res, next) => {
  try {
    const { page = 1, limit = 10, search } = req.query;
    const { page: pageNum, limit: pageLimit, skip } = PaginationHelper.getPaginationParams(page, limit);

    const query = {};
    if (search) {
      query.$or = [
        { title: { $regex: search, $options: 'i' } },
        { message: { $regex: search, $options: 'i' } },
      ];
    }

    const announcements = await Announcement.find(query)
      .populate('createdBy', 'name email')
      .populate('batchIds', 'name')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(pageLimit);

    const total = await Announcement.countDocuments(query);

    res.status(200).json({
      success: true,
      data: announcements,
      pagination: PaginationHelper.getPaginationMeta(total, pageNum, pageLimit),
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Delete announcement (soft delete)
// @route   DELETE /api/admin/announcements/:id
// @access  Private/Admin
exports.deleteAnnouncement = async (req, res, next) => {
  try {
    const announcement = await Announcement.findById(req.params.id);

    if (!announcement) {
      return res.status(404).json({
        success: false,
        error: 'Announcement not found',
      });
    }

    // Soft delete the announcement
    await announcement.softDelete();

    // Remove associated portal notifications
    await Notification.deleteMany({
      'payload.announcementId': announcement._id,
    });

    logger.info(`Announcement ${announcement._id} and its notifications deleted`);

    res.status(200).json({
      success: true,
      message: 'Announcement deleted successfully',
    });
  } catch (error) {
    next(error);
  }
};

  // @desc    Create instructor (admin only)
  // @route   POST /api/admin/instructors
  // @access  Private/Admin
  exports.createInstructor = async (req, res, next) => {
    try {
      const { name, email, mobile } = req.body;

      // Validate required fields
      if (!name || !email) {
        return res.status(400).json({
          success: false,
          error: 'Name and email are required',
        });
      }

      // Validate email format
      const emailRegex = /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/;
      if (!emailRegex.test(email)) {
        return res.status(400).json({
          success: false,
          error: 'Please provide a valid email',
        });
      }

      // Check if email already exists
      const existingUser = await User.findOne({ email: email.toLowerCase() });
      if (existingUser) {
        return res.status(409).json({
          success: false,
          error: 'User with this email already exists',
        });
      }

      // Generate random password (8-12 characters)
      const passwordLength = Math.floor(Math.random() * 5) + 8; // 8-12 chars
      const generatedPassword = crypto.randomBytes(passwordLength).toString('hex').slice(0, passwordLength);

      // Create instructor
      const instructor = await User.create({
        name: name.trim(),
        email: email.toLowerCase().trim(),
        password: generatedPassword,
        mobile: mobile?.trim() || '',
        role: 'instructor',
        status: 'active',
        approvalStatus: 'approved', // Instructors are auto-approved when created by admin
      });

      logger.info(`Instructor created by admin: ${instructor._id}`);

      // Send email with credentials (async, don't wait)
      const emailSubject = 'Your Instructor Account Created';
      const emailHtml = `
        <h2>Welcome to the LMS</h2>
        <p>Your instructor account has been created successfully.</p>
        <h3>Login Credentials:</h3>
        <p><strong>Email:</strong> ${email}</p>
        <p><strong>Password:</strong> ${generatedPassword}</p>
        <p><strong>Login URL:</strong> ${process.env.FRONTEND_URL || 'http://localhost:3001'}/login</p>
        <hr />
        <p>Please change your password after your first login for security.</p>
        <p>If you have any issues, contact the administrator.</p>
      `;

      sendEmail({
        email: email,
        subject: emailSubject,
        html: emailHtml,
      }).catch(err => {
        logger.error(`Failed to send instructor credentials email to ${email}: ${err.message}`);
      });

      res.status(201).json({
        success: true,
        message: 'Instructor created successfully and credentials sent via email',
        data: {
          id: instructor._id,
          name: instructor.name,
          email: instructor.email,
          mobile: instructor.mobile,
          role: instructor.role,
          status: instructor.status,
          createdAt: instructor.createdAt,
        },
      });
    } catch (error) {
      next(error);
    }
  };

// @desc    Get all instructors
// @route   GET /api/admin/instructors
// @access  Private/Admin
exports.getInstructors = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, search, status } = req.query;
    const query = { role: 'instructor' };
    if (status) {
      query.status = status;
    }
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
      ];
    }

    const total = await User.countDocuments(query);
    const { page: pageNum, limit: pageLimit, skip } = PaginationHelper.getPaginationParams(page, limit);

    const instructors = await User.find(query)
      .select('-password')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(pageLimit);

    const instructorIds = instructors.map((instructor) => instructor._id);
    const assignmentCounts = await CourseInstructor.aggregate([
      { $match: { instructor_id: { $in: instructorIds } } },
      { $group: { _id: '$instructor_id', count: { $sum: 1 } } },
    ]);
    const assignmentMap = new Map(assignmentCounts.map((row) => [String(row._id), row.count]));

    const data = instructors.map((instructor) => ({
      ...instructor.toObject(),
      assignedCoursesCount: assignmentMap.get(String(instructor._id)) || 0,
    }));

    res.status(200).json({
      success: true,
      data,
      pagination: PaginationHelper.getPaginationMeta(total, pageNum, pageLimit),
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Update instructor status
// @route   PUT /api/admin/instructors/:id/status
// @access  Private/Admin
exports.updateInstructorStatus = async (req, res, next) => {
  try {
    const { status } = req.body;
    if (!['active', 'blocked'].includes(status)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid status',
      });
    }

    const instructor = await User.findById(req.params.id);
    if (!instructor || instructor.role !== 'instructor') {
      return res.status(404).json({
        success: false,
        error: 'Instructor not found',
      });
    }

    instructor.status = status;
    await instructor.save();
    await logAdminAction({
      action: 'instructor.status.updated',
      actorId: req.user.id,
      entityType: 'instructor',
      entityId: instructor._id,
      metadata: { status },
    });

    return res.status(200).json({
      success: true,
      data: instructor,
      message: `Instructor ${status === 'active' ? 'activated' : 'blocked'} successfully`,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get pending student approvals
// @route   GET /api/admin/students/approval/pending
// @access  Private/Admin
exports.getPendingStudents = async (req, res, next) => {
  try {
    const students = await User.find({ 
      role: 'student', 
      approvalStatus: 'pending' 
    })
      .select('-password')
      .populate('batchId', 'name')
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      data: students,
      count: students.length,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Approve student account
// @route   PUT /api/admin/students/:id/approval/approve
// @access  Private/Admin
exports.approveStudent = async (req, res, next) => {
  try {
    const { reason } = req.body || {};
    const student = await User.findById(req.params.id);

    if (!student || student.role !== 'student') {
      return res.status(404).json({
        success: false,
        error: 'Student not found',
      });
    }

    if (student.approvalStatus === 'approved') {
      return res.status(400).json({
        success: false,
        error: 'Student is already approved',
      });
    }

    await student.approveUser(req.user.id, reason);
    await logAdminAction({
      action: 'student.approved',
      actorId: req.user.id,
      entityType: 'student',
      entityId: student._id,
      metadata: { reason: reason || '' },
    });

    res.status(200).json({
      success: true,
      message: 'Student account approved successfully',
      data: student,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Reject student account
// @route   PUT /api/admin/students/:id/approval/reject
// @access  Private/Admin
exports.rejectStudent = async (req, res, next) => {
  try {
    const { reason } = req.body;

    const student = await User.findById(req.params.id);

    if (!student || student.role !== 'student') {
      return res.status(404).json({
        success: false,
        error: 'Student not found',
      });
    }

    if (student.approvalStatus === 'rejected') {
      return res.status(400).json({
        success: false,
        error: 'Student is already rejected',
      });
    }

    await student.rejectUser(reason, req.user.id);
    await logAdminAction({
      action: 'student.rejected',
      actorId: req.user.id,
      entityType: 'student',
      entityId: student._id,
      metadata: { reason: reason || '' },
    });

    res.status(200).json({
      success: true,
      message: 'Student account rejected',
      data: student,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Update student academic information
// @route   PUT /api/admin/students/:id/update-academic
// @access  Private/Admin
exports.updateAcademicInfo = async (req, res, next) => {
  try {
    const { batchId, batch, term } = req.body;
    const normalizedTerm = term || batch;
    const studentId = req.params.id;

    // Find student
    const student = await User.findById(studentId);

    if (!student || student.role !== 'student') {
      return res.status(404).json({
        success: false,
        error: 'Student not found',
      });
    }

    // Update batch term if provided
    if (normalizedTerm) {
      if (!['longTerm', 'shortTerm'].includes(normalizedTerm)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid batch term. Must be longTerm or shortTerm',
        });
      }
      student.batch = normalizedTerm;
    }

    // Update batchId if provided
    if (batchId) {
      const Batch = require('../models/Batch');
      
      // Verify batch exists
      const batchExists = await Batch.findById(batchId);
      if (!batchExists) {
        return res.status(404).json({
          success: false,
          error: 'Batch not found',
        });
      }

      student.batchId = batchId;
    }

    await student.save();
    await logAdminAction({
      action: 'student.academic.updated',
      actorId: req.user.id,
      entityType: 'student',
      entityId: student._id,
      metadata: { batchId: student.batchId, term: student.batch },
    });

    // Populate batch info
    await student.populate('batchId', 'name isActive');

    res.status(200).json({
      success: true,
      message: 'Student academic information updated successfully',
      data: student,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Bulk update student accounts
// @route   POST /api/admin/students/bulk-actions
// @access  Private/Admin
exports.bulkUpdateStudents = async (req, res, next) => {
  try {
    const { studentIds = [], action, reason = '' } = req.body;
    if (!Array.isArray(studentIds) || studentIds.length === 0) {
      return res.status(400).json({ success: false, error: 'studentIds is required' });
    }
    if (!['approve', 'reject', 'block', 'unblock'].includes(action)) {
      return res.status(400).json({ success: false, error: 'Invalid action' });
    }

    const students = await User.find({
      _id: { $in: studentIds },
      role: 'student',
    });

    let updatedCount = 0;
    for (const student of students) {
      if (action === 'approve' && student.approvalStatus !== 'approved') {
        await student.approveUser(req.user.id, reason);
        updatedCount += 1;
      } else if (action === 'reject' && student.approvalStatus !== 'rejected') {
        await student.rejectUser(reason, req.user.id);
        updatedCount += 1;
      } else if (action === 'block' && student.status !== 'blocked') {
        student.status = 'blocked';
        await student.save();
        updatedCount += 1;
      } else if (action === 'unblock' && student.status !== 'active') {
        student.status = 'active';
        await student.save();
        updatedCount += 1;
      }
    }

    await logAdminAction({
      action: `student.bulk.${action}`,
      actorId: req.user.id,
      entityType: 'student',
      entityId: 'bulk',
      metadata: { studentCount: studentIds.length, updatedCount, reason },
    });

    return res.status(200).json({
      success: true,
      data: { updatedCount },
      message: 'Bulk action completed',
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Export students as CSV
// @route   GET /api/admin/students/export
// @access  Private/Admin
exports.exportStudentsCsv = async (req, res, next) => {
  try {
    const { status, approvalStatus, batchId } = req.query;
    const query = { role: 'student' };
    if (status) query.status = status;
    if (approvalStatus) query.approvalStatus = approvalStatus;
    if (batchId) query.batchId = batchId;

    const students = await User.find(query)
      .select('name email status approvalStatus batch batchId createdAt')
      .populate('batchId', 'name')
      .sort({ createdAt: -1 })
      .lean();

    const header = ['name', 'email', 'status', 'approvalStatus', 'term', 'batchName', 'createdAt'];
    const rows = students.map((student) => [
      student.name || '',
      student.email || '',
      student.status || '',
      student.approvalStatus || '',
      student.batch || '',
      student.batchId?.name || '',
      student.createdAt ? new Date(student.createdAt).toISOString() : '',
    ]);
    const csv = [header, ...rows]
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');

    await logAdminAction({
      action: 'student.export.csv',
      actorId: req.user.id,
      entityType: 'student',
      entityId: 'export',
      metadata: { rowCount: students.length },
    });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="students-export.csv"');
    return res.status(200).send(csv);
  } catch (error) {
    next(error);
  }
};

// @desc    Get admin audit logs
// @route   GET /api/admin/audit-logs
// @access  Private/Admin
exports.getAuditLogs = async (req, res, next) => {
  try {
    const { action, page = 1, limit = 20 } = req.query;
    const query = {};
    if (action) query.action = action;

    const total = await AdminAuditLog.countDocuments(query);
    const { page: pageNum, limit: pageLimit, skip } = PaginationHelper.getPaginationParams(page, limit);
    const logs = await AdminAuditLog.find(query)
      .populate('actorId', 'name email')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(pageLimit)
      .lean();

    return res.status(200).json({
      success: true,
      data: logs,
      pagination: PaginationHelper.getPaginationMeta(total, pageNum, pageLimit),
    });
  } catch (error) {
    next(error);
  }
};
