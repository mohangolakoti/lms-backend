const Course = require('../models/Course');
const User = require('../models/User');
const Progress = require('../models/Progress');
const Assessment = require('../models/Assessment');
const Submission = require('../models/Submission');
const Announcement = require('../models/Announcement');
const Notification = require('../models/Notification');

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
    const { status, batch, search, approvalStatus } = req.query;
    const query = { role: 'student' };

    if (status) query.status = status;
    if (batch) query.batch = batch;
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
    const announcement = await Announcement.create({
      ...req.body,
      createdBy: req.user.id,
    });

    // Create notifications for target users
    if (announcement.target === 'global') {
      const students = await User.find({ role: 'student', status: 'active' });
      if (students.length > 0) {
        const notifications = students.map(student => ({
          userId: student._id,
          type: 'announcement',
          title: announcement.title,
          message: announcement.message,
          payload: { announcementId: announcement._id },
        }));
        await Notification.insertMany(notifications);
      }
    } else if (announcement.target === 'course') {
      const course = await Course.findById(announcement.courseId);
      if (course) {
        // Find students matching the course term
        const query = {
          role: 'student',
          status: 'active',
        };
        
        if (course.term === 'both') {
          // All students can access
        } else {
          query.batch = course.term;
        }

        const students = await User.find(query);
        
        if (students.length > 0) {
          const notifications = students.map(student => ({
            userId: student._id,
            type: 'announcement',
            title: announcement.title,
            message: announcement.message,
            payload: { announcementId: announcement._id, courseId: course._id },
          }));
          await Notification.insertMany(notifications);
        }
      }
    }

    res.status(201).json({
      success: true,
      data: announcement,
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
