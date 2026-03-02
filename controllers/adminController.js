const Course = require('../models/Course');
const User = require('../models/User');
const Progress = require('../models/Progress');
const Assessment = require('../models/Assessment');
const Submission = require('../models/Submission');
const Announcement = require('../models/Announcement');
const Notification = require('../models/Notification');
const Batch = require('../models/Batch');
const sendEmail = require('../utils/sendEmail');
const { sendBatchWhatsAppMessages } = require('../utils/whatsappService');
const logger = require('../utils/logger');

// @desc    Get admin dashboard stats
// @route   GET /api/admin/dashboard
// @access  Private/Admin
exports.getDashboard = async (req, res, next) => {
  try {
    const totalStudents = await User.countDocuments({ role: 'student' });
    const activeStudents = await User.countDocuments({ role: 'student', status: 'active' });
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

    res.status(200).json({
      success: true,
      data: {
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
    const { status, batch, search, approvalStatus, batchId } = req.query;
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

    const students = await User.find(query)
      .select('-password')
      .populate('batchId', 'name isActive')
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

// @desc    Get student by ID
// @route   GET /api/admin/students/:id
// @access  Private/Admin
exports.getStudent = async (req, res, next) => {
  try {
    const student = await User.findById(req.params.id).select('-password');

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
    const { batches, ...courseData } = req.body;

    // Validate batches
    if (!batches || !Array.isArray(batches) || batches.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'At least one batch must be assigned',
      });
    }

    // Verify all batches exist
    const Batch = require('../models/Batch');
    const existingBatches = await Batch.find({ _id: { $in: batches } });

    if (existingBatches.length !== batches.length) {
      return res.status(400).json({
        success: false,
        error: 'One or more batches do not exist',
      });
    }

    const course = await Course.create({
      ...courseData,
      batches,
      instructorId: req.body.instructorId || req.user.id,
    });

    await course.populate('batches', 'name isActive');
    await course.populate('instructorId', 'name email');

    res.status(201).json({
      success: true,
      data: course,
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
    const course = await Course.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    );

    if (!course) {
      return res.status(404).json({
        success: false,
        error: 'Course not found',
      });
    }

    res.status(200).json({
      success: true,
      data: course,
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
    const courses = await Course.find()
      .populate('instructorId', 'name email')
      .populate('batches', 'name isActive')
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      data: courses,
      count: courses.length,
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
exports.createAnnouncement = async (req, res, next) => {
  try {
    const { title, message, targetType, batchIds, deliveryChannels } = req.body;

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

    if (targetType === 'global' && batchIds && batchIds.length > 0) {
      return res.status(400).json({
        success: false,
        error: 'Batch IDs must be empty for global announcements',
      });
    }

    // Create announcement
    const announcement = await Announcement.create({
      title,
      message,
      targetType,
      batchIds: targetType === 'batch' ? batchIds : [],
      deliveryChannels,
      createdBy: req.user.id,
    });

    // Determine target students based on targetType
    let targetStudents = [];

    if (targetType === 'global') {
      // Get all active, approved students
      targetStudents = await User.find({
        role: 'student',
        status: 'active',
        approvalStatus: 'approved',
      }).select('_id email name phoneNumber batchId');
    } else if (targetType === 'batch') {
      // Get students in specified batches
      targetStudents = await User.find({
        role: 'student',
        status: 'active',
        approvalStatus: 'approved',
        batchId: { $in: batchIds },
      }).select('_id email name phoneNumber batchId');
    }

    logger.info(`Announcement targeting ${targetStudents.length} students`);

    // Process delivery channels asynchronously (non-blocking)
    // Do NOT await these - return success immediately after DB save
    handleAnnouncementDelivery(announcement, targetStudents, deliveryChannels).catch(
      error => logger.error('Error in announcement delivery:', error)
    );

    // Populate references for response
    const populatedAnnouncement = await Announcement.findById(announcement._id)
      .populate('createdBy', 'name email')
      .populate('batchIds', 'name');

    res.status(201).json({
      success: true,
      data: populatedAnnouncement,
      message: 'Announcement created successfully. Notifications are being sent.',
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
  // Process all channels in parallel
  const deliveryPromises = [];

  if (deliveryChannels.includes('portal')) {
    deliveryPromises.push(
      handlePortalDelivery(announcement, targetStudents)
    );
  }

  if (deliveryChannels.includes('email')) {
    deliveryPromises.push(
      handleEmailDelivery(announcement, targetStudents)
    );
  }

  if (deliveryChannels.includes('whatsapp')) {
    deliveryPromises.push(
      handleWhatsAppDelivery(announcement, targetStudents)
    );
  }

  // Execute all channels in parallel for scalability
  const results = await Promise.allSettled(deliveryPromises);

  results.forEach((result, index) => {
    const channel = deliveryChannels[index];
    if (result.status === 'rejected') {
      logger.error(`Failed to deliver via ${channel}:`, result.reason);
    } else {
      logger.info(`Successfully handled ${channel} delivery:`, result.value);
    }
  });
}

/**
 * Create portal notifications for each student
 * This is fast and can be done synchronously within batch operations
 */
async function handlePortalDelivery(announcement, targetStudents) {
  if (targetStudents.length === 0) {
    return { channel: 'portal', sent: 0 };
  }

  const notifications = targetStudents.map(student => ({
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

  return { channel: 'portal', sent: notifications.length };
}

/**
 * Send emails asynchronously for scalability
 * Uses Promise.all for parallel email sending
 */
async function handleEmailDelivery(announcement, targetStudents) {
  if (targetStudents.length === 0) {
    return { channel: 'email', sent: 0, failed: 0 };
  }

  const emailPromises = targetStudents.map(student =>
    sendEmail({
      email: student.email,
      subject: `New Announcement: ${announcement.title}`,
      html: `
        <h2>${announcement.title}</h2>
        <p>Dear ${student.name},</p>
        <p>${announcement.message}</p>
        <p>Regards,<br>LMS Administration</p>
      `,
      message: announcement.message,
    }).catch(error => {
      logger.warn(`Failed to send email to ${student.email}:`, error.message);
      return null;
    })
  );

  const results = await Promise.all(emailPromises);
  const successCount = results.filter(r => r !== null).length;
  const failureCount = results.filter(r => r === null).length;

  logger.info(`Email: Sent to ${successCount}, Failed: ${failureCount}`);

  return { channel: 'email', sent: successCount, failed: failureCount };
}

/**
 * Send WhatsApp messages asynchronously
 * Uses WhatsApp service for message delivery
 */
async function handleWhatsAppDelivery(announcement, targetStudents) {
  if (targetStudents.length === 0) {
    return { channel: 'whatsapp', sent: 0, failed: 0 };
  }

  // Filter students with phone numbers
  const studentsWithPhone = targetStudents.filter(s => s.phoneNumber);

  if (studentsWithPhone.length === 0) {
    logger.info('WhatsApp: No students with phone numbers');
    return { channel: 'whatsapp', sent: 0, failed: 0 };
  }

  const messages = studentsWithPhone.map(student => ({
    phoneNumber: student.phoneNumber,
    title: announcement.title,
    message: announcement.message,
  }));

  const result = await sendBatchWhatsAppMessages(messages);

  logger.info(`WhatsApp: Sent to ${result.successful}, Failed: ${result.failed}`);

  return { channel: 'whatsapp', sent: result.successful, failed: result.failed };
}

// @desc    Get all announcements
// @route   GET /api/admin/announcements
// @access  Private/Admin
exports.getAnnouncements = async (req, res, next) => {
  try {
    const { page = 1, limit = 10, search } = req.query;
    const skip = (page - 1) * limit;

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
      .limit(parseInt(limit));

    const total = await Announcement.countDocuments(query);

    res.status(200).json({
      success: true,
      data: announcements,
      pagination: {
        current: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit),
      },
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

// @desc    Get all instructors
// @route   GET /api/admin/instructors
// @access  Private/Admin
exports.getInstructors = async (req, res, next) => {
  try {
    const instructors = await User.find({ role: 'instructor' })
      .select('-password')
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      data: instructors,
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

    student.approvalStatus = 'approved';
    await student.save();

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

    student.approvalStatus = 'rejected';
    await student.save();

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
    const { batchId, batch: term } = req.body;
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
    if (term) {
      if (!['longTerm', 'shortTerm'].includes(term)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid batch term. Must be longTerm or shortTerm',
        });
      }
      student.batch = term;
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
