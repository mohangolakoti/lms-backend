const Course = require('../models/Course');
const Progress = require('../models/Progress');
const Assessment = require('../models/Assessment');
const Submission = require('../models/Submission');
const Announcement = require('../models/Announcement');
const AnnouncementRead = require('../models/AnnouncementRead');
const Notification = require('../models/Notification');
const NotificationPreference = require('../models/NotificationPreference');
const LessonBookmark = require('../models/LessonBookmark');
const LessonNote = require('../models/LessonNote');
const User = require('../models/User');
const {
  assertCourseAccess,
  buildAssignedCoursesQuery,
  getAssessmentWindowStatus,
  assertAssessmentWindow,
  sortModulesWithLessons,
  findContinueLesson,
} = require('../utils/studentAccess');
const { NotFoundError, ForbiddenError } = require('../utils/errors');

const buildAnnouncementFilter = (user) => {
  const now = new Date();
  const announcementFilter = {
    $or: [{ targetType: 'global' }],
    $and: [
      {
        $or: [
          { deliveryState: 'sent' },
          { scheduledAt: { $lte: now } },
        ],
      },
      {
        $or: [
          { expiresAt: null },
          { expiresAt: { $gt: now } },
        ],
      },
    ],
  };

  if (user.batchId) {
    announcementFilter.$or.push({
      targetType: 'batch',
      batchIds: user.batchId,
    });
  }

  return announcementFilter;
};

const updateActivityStreak = (progress) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (!progress.lastActivityDate) {
    progress.currentStreakDays = 1;
    progress.lastActivityDate = today;
    return;
  }

  const last = new Date(progress.lastActivityDate);
  last.setHours(0, 0, 0, 0);
  const diffDays = Math.round((today - last) / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return;
  if (diffDays === 1) {
    progress.currentStreakDays = (progress.currentStreakDays || 0) + 1;
  } else {
    progress.currentStreakDays = 1;
  }
  progress.lastActivityDate = today;
};

// @desc    Get student dashboard
// @route   GET /api/students/dashboard
// @access  Private/Student
exports.getDashboard = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const user = await User.findById(userId).populate('batchId').lean();

    // Check if student has batchId assigned
    if (!user || !user.batchId) {
      return res.status(200).json({
        success: true,
        data: {
          courses: [],
          metrics: {
            totalCourses: 0,
            completedCourses: 0,
            totalModules: 0,
            completedModules: 0,
            totalTimeSpent: 0,
            totalTimeSpentSeconds: 0,
            totalAssessments: 0,
            completedAssessments: 0,
            totalQuestionsAttempted: 0,
          },
        },
      });
    }

    // Parallelize courses, progress, and submissions queries
    const [courses, progressData, submissions] = await Promise.all([
      Course.find({
        $and: [
          {
            $or: [
              { term: user.batch },
              { term: 'both' },
            ],
          },
          { batches: user.batchId._id },
        ],
        visibility: 'published',
      })
        .populate('instructorId', 'name email')
        .select('title thumbnailUrl level instructorId modules')
        .lean(),
      Progress.find({ userId }).lean(),
      Submission.find({ userId }).lean(),
    ]);

    // Calculate dashboard metrics
    let totalTimeSpent = 0;
    let totalCourses = courses.length;
    let completedCourses = 0;
    let totalModules = 0;
    let completedModules = 0;
    let totalAssessments = 0;
    let completedAssessments = 0;
    let totalQuestionsAttempted = 0;

    const coursesWithProgress = courses.map(course => {
      const progress = progressData.find(p => p.courseId.toString() === course._id.toString());
      
      if (progress) {
        totalTimeSpent += progress.totalTimeSpent || 0;
        if (progress.completed) completedCourses++;
        
        const moduleCount = course.modules ? course.modules.length : 0;
        totalModules += moduleCount;
        
        const completedModuleCount = progress.moduleProgress
          ? progress.moduleProgress.filter(mp => mp.completionPercentage === 100).length
          : 0;
        completedModules += completedModuleCount;
      }

      return {
        courseId: course._id,
        title: course.title,
        thumbnailUrl: course.thumbnailUrl,
        level: course.level,
        instructor: course.instructorId?.name || 'Unknown Instructor',
        progress: progress ? progress.overallCoursePercentage : 0,
        completed: progress ? progress.completed : false,
      };
    });

    // Get assessments for assigned courses
    const courseIds = courses.map(c => c._id);
    const assessments = await Assessment.find({
      courseId: { $in: courseIds },
      visibility: 'published',
    }).select('_id').lean();

    totalAssessments = assessments.length;
    completedAssessments = submissions.length;
    
    submissions.forEach(submission => {
      totalQuestionsAttempted += submission.answers ? submission.answers.length : 0;
    });

    res.status(200).json({
      success: true,
      data: {
        courses: coursesWithProgress,
        metrics: {
          totalCourses,
          completedCourses,
          totalModules,
          completedModules,
          totalTimeSpent: totalTimeSpent,
          totalTimeSpentSeconds: totalTimeSpent,
          totalAssessments,
          completedAssessments,
          totalQuestionsAttempted,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get assigned courses
// @route   GET /api/students/courses
// @access  Private/Student
exports.getCourses = async (req, res, next) => {
  try {
    const { page, limit, sortBy, sortOrder, search } = req.query;
    const ResponseHandler = require('../utils/responseHandler');
    const PaginationHelper = require('../utils/paginationHelper');
    const QueryOptimizer = require('../utils/queryOptimizer');
    const { NotFoundError } = require('../utils/errors');

    const userId = req.user.id;
    const user = await User.findById(userId).populate('batchId');

    if (!user) {
      throw new NotFoundError('User');
    }

    // Check if student has batchId assigned
    if (!user.batchId) {
      const pagination = PaginationHelper.getPaginationMeta(0, 1, 10);
      return ResponseHandler.paginated(res, [], pagination, 'No batch assigned yet');
    }

    // Build query: term matches OR is "both", AND batchId in course.batches
    let query = Course.find({
      $and: [
        {
          $or: [
            { term: user.batch },
            { term: 'both' },
          ],
        },
        { batches: user.batchId._id },
      ],
      visibility: 'published',
    });

    // Add search filter if provided
    if (search && search.trim()) {
      query = query.find(QueryOptimizer.buildSearchFilter(search, ['title', 'description']));
    }

    // Get total count before pagination
    const total = await Course.countDocuments(query.getFilter());

    // Get pagination params
    const { page: pageNum, limit: pageLimit, skip } = PaginationHelper.getPaginationParams(page, limit);

    // Apply population, sorting, and pagination
    const courses = await query
      .populate('instructorId', 'name email')
      .populate('batches', 'name isActive')
      .sort(QueryOptimizer.buildSort(sortBy || 'createdAt', sortOrder || -1))
      .skip(skip)
      .limit(pageLimit)
      .select('-modules.lessons')
      .lean();

    // Fetch progress data
    const progressData = await Progress.find({ userId }).lean();

    // Merge progress into courses
    const coursesWithProgress = courses.map(course => {
      const progress = progressData.find(p => p.courseId.toString() === course._id.toString());
      return {
        ...course,
        progress: progress ? progress.overallCoursePercentage : 0,
        completed: progress ? progress.completed : false,
      };
    });

    const pagination = PaginationHelper.getPaginationMeta(total, pageNum, pageLimit);

    return ResponseHandler.paginated(res, coursesWithProgress, pagination);
  } catch (error) {
    next(error);
  }
};

// @desc    Get course details
// @route   GET /api/students/courses/:courseId
// @access  Private/Student
exports.getCourseDetails = async (req, res, next) => {
  try {
    const { courseId } = req.params;
    const userId = req.user.id;
    const ResponseHandler = require('../utils/responseHandler');
    const { NotFoundError } = require('../utils/errors');

    // Fetch user with batchId
    const user = await User.findById(userId).populate('batchId');

    if (!user) {
      throw new NotFoundError('User');
    }

    const course = await Course.findById(courseId)
      .populate('instructorId', 'name email')
      .populate('batches', 'name isActive');

    if (!course) {
      throw new NotFoundError('Course');
    }

    assertCourseAccess(user, course);

    // Get or create progress (avoid N+1 queries)
    let progress = await Progress.findOne({ userId, courseId });

    if (!progress) {
      progress = await Progress.create({
        userId,
        courseId,
        moduleProgress: course.modules.map(module => ({
          moduleId: module._id,
          completedLessons: [],
          completionPercentage: 0,
        })),
        lessonProgress: [],
      });
    }

    const modulesWithProgress = [...course.modules]
      .sort((a, b) => a.order - b.order)
      .map((module) => {
        const moduleProg = progress.moduleProgress.find(
          (mp) => mp.moduleId.toString() === module._id.toString()
        );

        const lessonsWithProgress = [...(module.lessons || [])]
          .sort((a, b) => a.order - b.order)
          .map((lesson) => {
            const lessonProg = progress.lessonProgress.find(
              (lp) => lp.lessonId.toString() === lesson._id.toString()
            );
            const lessonObj = lesson.toObject ? lesson.toObject() : lesson;

            return {
              ...lessonObj,
              completed: lessonProg ? lessonProg.completed : false,
              lastWatchedSecond: lessonProg ? lessonProg.lastWatchedSecond : 0,
            };
          });

        const moduleObj = module.toObject ? module.toObject() : module;

        return {
          ...moduleObj,
          lessons: lessonsWithProgress,
          completionPercentage: moduleProg ? moduleProg.completionPercentage : 0,
        };
      });

    res.status(200).json({
      success: true,
      data: {
        course: {
          ...course.toObject(),
          modules: modulesWithProgress,
        },
        progress: {
          overallCoursePercentage: progress.overallCoursePercentage,
          totalTimeSpent: progress.totalTimeSpent,
          completed: progress.completed,
          lastAccessedLessonId: progress.lastAccessedLessonId,
          lastAccessedModuleId: progress.lastAccessedModuleId,
          currentStreakDays: progress.currentStreakDays || 0,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Update lesson progress
// @route   PUT /api/students/courses/:courseId/lessons/:lessonId/progress
// @access  Private/Student
exports.updateLessonProgress = async (req, res, next) => {
  try {
    const { courseId, lessonId } = req.params;
    const userId = req.user.id;
    const { completed, lastWatchedSecond } = req.body;

    const course = await Course.findById(courseId);
    if (!course) {
      return res.status(404).json({
        success: false,
        error: 'Course not found',
      });
    }

    const user = await User.findById(userId).populate('batchId');
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    try {
      assertCourseAccess(user, course);
    } catch (accessError) {
      return res.status(403).json({ success: false, error: accessError.message });
    }

    // Find the lesson's module
    let lessonModule = null;
    let lesson = null;
    for (const module of course.modules) {
      const foundLesson = module.lessons.id(lessonId);
      if (foundLesson) {
        lessonModule = module;
        lesson = foundLesson;
        break;
      }
    }

    if (!lesson) {
      return res.status(404).json({
        success: false,
        error: 'Lesson not found',
      });
    }

    // Get or create progress
    let progress = await Progress.findOne({ userId, courseId });
    if (!progress) {
      progress = await Progress.create({
        userId,
        courseId,
        moduleProgress: course.modules.map(m => ({
          moduleId: m._id,
          completedLessons: [],
          completionPercentage: 0,
        })),
        lessonProgress: [],
      });
    }

    // Update lesson progress
    const lessonProgIndex = progress.lessonProgress.findIndex(
      lp => lp.lessonId.toString() === lessonId
    );

    let previousTime = 0;
    if (lessonProgIndex >= 0) {
      previousTime = progress.lessonProgress[lessonProgIndex].lastWatchedSecond || 0;
      if (completed !== undefined) {
        progress.lessonProgress[lessonProgIndex].completed = completed;
        if (completed) {
          progress.lessonProgress[lessonProgIndex].completedAt = Date.now();
        }
      }
      if (lastWatchedSecond !== undefined) {
        const clampedTime = Math.max(0, Math.floor(lastWatchedSecond));
        progress.lessonProgress[lessonProgIndex].lastWatchedSecond = clampedTime;
      }
    } else {
      previousTime = 0;
      progress.lessonProgress.push({
        lessonId,
        completed: completed || false,
        lastWatchedSecond: Math.max(0, Math.floor(lastWatchedSecond || 0)),
        completedAt: completed ? Date.now() : undefined,
      });
    }

    // Update module progress
    const moduleProgIndex = progress.moduleProgress.findIndex(
      mp => mp.moduleId.toString() === lessonModule._id.toString()
    );

    if (moduleProgIndex >= 0) {
      const completedLessons = progress.lessonProgress
        .filter(lp => {
          const lesson = lessonModule.lessons.id(lp.lessonId);
          return lesson && lp.completed;
        })
        .map(lp => lp.lessonId);

      progress.moduleProgress[moduleProgIndex].completedLessons = completedLessons;
      progress.moduleProgress[moduleProgIndex].completionPercentage =
        lessonModule.lessons.length > 0
          ? (completedLessons.length / lessonModule.lessons.length) * 100
          : 0;
    }

    // Calculate overall course percentage
    const totalLessons = course.modules.reduce((sum, m) => sum + m.lessons.length, 0);
    const completedLessonsCount = progress.lessonProgress.filter(lp => lp.completed).length;
    progress.overallCoursePercentage = Math.min(100, (completedLessonsCount / totalLessons) * 100);

    // Update time spent if provided
    if (lastWatchedSecond !== undefined) {
      const clampedTime = Math.max(0, Math.floor(lastWatchedSecond));
      const timeDiff = clampedTime - previousTime;
      if (timeDiff > 0) {
        progress.totalTimeSpent += timeDiff;
      }
    }

    // Check if course is completed
    if (progress.overallCoursePercentage === 100 && !progress.completed) {
      progress.completed = true;
      progress.completedAt = Date.now();
    }

    progress.lastAccessed = Date.now();
    progress.lastAccessedLessonId = lessonId;
    progress.lastAccessedModuleId = lessonModule._id;
    updateActivityStreak(progress);
    await progress.save();

    res.status(200).json({
      success: true,
      data: progress,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get assessments for student
// @route   GET /api/students/assessments
// @access  Private/Student
exports.getAssessments = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { status, courseId } = req.query;
    const user = await User.findById(userId).populate('batchId');

    const courseQuery = buildAssignedCoursesQuery(user);
    if (!courseQuery) {
      return res.status(200).json({ success: true, data: [] });
    }

    if (courseId) {
      courseQuery._id = courseId;
    }

    const courses = await Course.find(courseQuery).select('_id title');
    const courseIds = courses.map(c => c._id);

    const assessments = await Assessment.find({
      courseId: { $in: courseIds },
      visibility: 'published',
    })
      .populate('courseId', 'title')
      .populate('createdBy', 'name')
      .select('-questions.correctAnswer');

    const submissions = await Submission.find({ userId });
    const now = new Date();

    let assessmentsWithStatus = assessments.map(assessment => {
      const submission = submissions.find(
        s => s.assessmentId.toString() === assessment._id.toString()
      );
      const windowStatus = getAssessmentWindowStatus(assessment, now);

      return {
        ...assessment.toObject(),
        questionCount: assessment.questions?.length || 0,
        questions: undefined,
        windowStatus,
        submitted: !!submission,
        submission: submission ? {
          score: submission.score,
          percentage: submission.percentage,
          passed: submission.passed,
          submittedAt: submission.submittedAt,
        } : null,
      };
    });

    if (status) {
      assessmentsWithStatus = assessmentsWithStatus.filter((assessment) => {
        if (status === 'completed') return assessment.submitted;
        if (status === 'live') return !assessment.submitted && assessment.windowStatus === 'live';
        if (status === 'upcoming') return !assessment.submitted && assessment.windowStatus === 'upcoming';
        if (status === 'closed') return !assessment.submitted && assessment.windowStatus === 'closed';
        return true;
      });
    }

    res.status(200).json({
      success: true,
      data: assessmentsWithStatus,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get assessment by id for student
// @route   GET /api/students/assessments/:assessmentId
// @access  Private/Student
exports.getAssessmentById = async (req, res, next) => {
  try {
    const { assessmentId } = req.params;
    const userId = req.user.id;

    const assessment = await Assessment.findById(assessmentId)
      .populate('courseId', 'title term batches visibility')
      .populate('createdBy', 'name');

    if (!assessment || assessment.visibility !== 'published') {
      return res.status(404).json({
        success: false,
        error: 'Assessment not found',
      });
    }

    const user = await User.findById(userId).populate('batchId');
    if (!user || !user.batchId) {
      return res.status(403).json({
        success: false,
        error: 'No batch assigned',
      });
    }

    try {
      assertCourseAccess(user, assessment.courseId);
    } catch (accessError) {
      return res.status(403).json({ success: false, error: accessError.message });
    }

    const submission = await Submission.findOne({ userId, assessmentId });
    const windowStatus = getAssessmentWindowStatus(assessment);

    try {
      assertAssessmentWindow(assessment, {
        allowViewSubmitted: true,
        hasSubmission: !!submission,
      });
    } catch (windowError) {
      if (!submission) {
        return res.status(403).json({
          success: false,
          error: windowError.message,
          windowStatus,
        });
      }
    }

    const sanitizedQuestions = (assessment.questions || []).map(({ correctAnswer, ...question }) => question);

    return res.status(200).json({
      success: true,
      data: {
        ...assessment.toObject(),
        questions: sanitizedQuestions,
        windowStatus,
        submitted: !!submission,
        submission: submission ? {
          score: submission.score,
          percentage: submission.percentage,
          passed: submission.passed,
          submittedAt: submission.submittedAt,
          answers: submission.answers,
        } : null,
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Submit assessment
// @route   POST /api/students/assessments/:assessmentId/submit
// @access  Private/Student
exports.submitAssessment = async (req, res, next) => {
  try {
    const { assessmentId } = req.params;
    const userId = req.user.id;
    const { answers, timeTaken } = req.body;

    if (!Array.isArray(answers) || answers.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'At least one answer is required',
      });
    }

    if (typeof timeTaken !== 'number' || Number.isNaN(timeTaken) || timeTaken < 0) {
      return res.status(400).json({
        success: false,
        error: 'timeTaken must be a valid non-negative number',
      });
    }

    const assessment = await Assessment.findById(assessmentId);
    if (!assessment) {
      return res.status(404).json({
        success: false,
        error: 'Assessment not found',
      });
    }

    const user = await User.findById(userId).populate('batchId');
    const course = await Course.findById(assessment.courseId).select('term batches visibility');
    if (!user || !user.batchId || !course) {
      return res.status(403).json({
        success: false,
        error: 'You do not have access to this assessment',
      });
    }

    try {
      assertCourseAccess(user, course);
      assertAssessmentWindow(assessment);
    } catch (accessError) {
      return res.status(403).json({ success: false, error: accessError.message });
    }

    // Check if already submitted
    const existingSubmission = await Submission.findOne({ userId, assessmentId });
    if (existingSubmission) {
      return res.status(400).json({
        success: false,
        error: 'Assessment already submitted',
      });
    }

    // Calculate score
    let score = 0;
    const processedAnswers = answers.map((answer) => {
      // Convert questionId to number for array indexing
      const questionIndex = parseInt(answer.questionId);
      if (Number.isNaN(questionIndex)) return null;
      const question = assessment.questions[questionIndex];
      if (!question) return null;

      let isCorrect = false;
      let marksObtained = 0;

      if (question.type === 'mcq' || question.type === 'true-false') {
        isCorrect = String(answer.answer).toLowerCase() === String(question.correctAnswer).toLowerCase();
      } else {
        isCorrect = String(answer.answer).trim().toLowerCase() === String(question.correctAnswer).trim().toLowerCase();
      }

      if (isCorrect) {
        marksObtained = question.marks;
        score += question.marks;
      }

      return {
        questionId: questionIndex, // Store as number for consistent comparison
        answer: answer.answer,
        isCorrect,
        marksObtained,
      };
    }).filter(Boolean);

    const percentage = (score / assessment.totalMarks) * 100;
    const passed = percentage >= (assessment.passingMarks / assessment.totalMarks) * 100;

    let submission;
    try {
      submission = await Submission.create({
        userId,
        assessmentId,
        answers: processedAnswers,
        score,
        totalMarks: assessment.totalMarks,
        percentage,
        passed,
        timeTaken,
      });
    } catch (dbError) {
      if (dbError.code === 11000) {
        return res.status(400).json({
          success: false,
          error: 'Assessment already submitted',
        });
      }
      throw dbError;
    }

    res.status(201).json({
      success: true,
      data: submission,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get announcements
// @route   GET /api/students/announcements
// @access  Private/Student
exports.getAnnouncements = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const user = await User.findById(userId).select('batchId');

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found',
      });
    }

    const announcementFilter = buildAnnouncementFilter(user);

    const announcements = await Announcement.find(announcementFilter)
      .populate('createdBy', 'name')
      .populate('batchIds', 'name')
      .populate('courseId', 'title')
      .sort({ pinned: -1, createdAt: -1 });

    res.status(200).json({
      success: true,
      data: announcements,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get notifications
// @route   GET /api/students/notifications
// @access  Private/Student
exports.getNotifications = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { read, page = 1, limit = 50 } = req.query;

    const query = { userId };
    if (read !== undefined) {
      query.read = read === 'true';
    }

    const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 100);
    const skip = (Math.max(parseInt(page, 10) || 1, 1) - 1) * safeLimit;

    const notifications = await Notification.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(safeLimit);

    const total = await Notification.countDocuments(query);

    res.status(200).json({
      success: true,
      data: notifications,
      pagination: {
        page: Math.max(parseInt(page, 10) || 1, 1),
        limit: safeLimit,
        total,
        pages: Math.ceil(total / safeLimit),
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Mark notification as read
// @route   PUT /api/students/notifications/:notificationId/read
// @access  Private/Student
exports.markNotificationRead = async (req, res, next) => {
  try {
    const { notificationId } = req.params;
    const userId = req.user.id;

    const notification = await Notification.findOne({
      _id: notificationId,
      userId,
    });

    if (!notification) {
      return res.status(404).json({
        success: false,
        error: 'Notification not found',
      });
    }

    notification.read = true;
    notification.readAt = Date.now();
    await notification.save();

    res.status(200).json({
      success: true,
      data: notification,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Mark all notifications as read
// @route   PUT /api/students/notifications/read-all
// @access  Private/Student
exports.markAllNotificationsRead = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const now = Date.now();

    const result = await Notification.updateMany(
      { userId, read: false },
      { $set: { read: true, readAt: now } }
    );

    res.status(200).json({
      success: true,
      data: {
        modifiedCount: result.modifiedCount || 0,
      },
      message: 'All notifications marked as read',
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get notification preferences
// @route   GET /api/students/notifications/preferences
// @access  Private/Student
exports.getNotificationPreferences = async (req, res, next) => {
  try {
    let preferences = await NotificationPreference.findOne({ userId: req.user.id });
    if (!preferences) {
      preferences = await NotificationPreference.create({ userId: req.user.id });
    }

    res.status(200).json({
      success: true,
      data: preferences,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Update notification preferences
// @route   PUT /api/students/notifications/preferences
// @access  Private/Student
exports.updateNotificationPreferences = async (req, res, next) => {
  try {
    const { channels = {} } = req.body;

    const preferences = await NotificationPreference.findOneAndUpdate(
      { userId: req.user.id },
      {
        $set: {
          'channels.portal': channels.portal ?? true,
          'channels.email': channels.email ?? true,
          'channels.whatsapp': channels.whatsapp ?? false,
        },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    res.status(200).json({
      success: true,
      data: preferences,
      message: 'Notification preferences updated',
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get learning path summary for dashboard
// @route   GET /api/students/learning-path
// @access  Private/Student
exports.getLearningPath = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const user = await User.findById(userId).populate('batchId');

    if (!user?.batchId) {
      return res.status(200).json({
        success: true,
        data: {
          continueLesson: null,
          upcomingAssessments: [],
          recentAnnouncements: [],
          unreadNotificationCount: 0,
        },
      });
    }

    const courseQuery = buildAssignedCoursesQuery(user);
    const courses = await Course.find(courseQuery).populate('instructorId', 'name email');
    const progressData = await Progress.find({ userId });
    const now = new Date();

    let continueLesson = null;
    const rankedCourses = courses
      .map((course) => {
        const progress = progressData.find((p) => p.courseId.toString() === course._id.toString());
        return { course, progress, pct: progress?.overallCoursePercentage || 0, completed: progress?.completed };
      })
      .filter((row) => !row.completed)
      .sort((a, b) => a.pct - b.pct);

    for (const row of rankedCourses.slice(0, 3)) {
      const next = findContinueLesson(row.course, row.progress);
      if (next) {
        continueLesson = {
          ...next,
          progress: row.pct,
          instructor: row.course.instructorId?.name,
        };
        break;
      }
    }

    const courseIds = courses.map((c) => c._id);
    const assessments = await Assessment.find({
      courseId: { $in: courseIds },
      visibility: 'published',
    }).populate('courseId', 'title');

    const submissions = await Submission.find({ userId });
    const submittedIds = new Set(submissions.map((s) => s.assessmentId.toString()));

    const upcomingAssessments = assessments
      .filter((a) => !submittedIds.has(a._id.toString()) && getAssessmentWindowStatus(a, now) !== 'closed')
      .sort((a, b) => new Date(a.endDate || Infinity) - new Date(b.endDate || Infinity))
      .slice(0, 5)
      .map((a) => ({
        _id: a._id,
        title: a.title,
        courseTitle: a.courseId?.title,
        endDate: a.endDate,
        windowStatus: getAssessmentWindowStatus(a, now),
      }));

    const announcements = await Announcement.find(buildAnnouncementFilter(user))
      .populate('createdBy', 'name')
      .populate('courseId', 'title')
      .sort({ pinned: -1, createdAt: -1 })
      .limit(5);

    const unreadNotificationCount = await Notification.countDocuments({ userId, read: false });

    res.status(200).json({
      success: true,
      data: {
        continueLesson,
        upcomingAssessments,
        recentAnnouncements: announcements,
        unreadNotificationCount,
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get unread notification count
// @route   GET /api/students/notifications/unread-count
// @access  Private/Student
exports.getUnreadNotificationCount = async (req, res, next) => {
  try {
    const count = await Notification.countDocuments({ userId: req.user.id, read: false });
    res.status(200).json({ success: true, data: { count } });
  } catch (error) {
    next(error);
  }
};

// @desc    Mark announcement as read
// @route   PUT /api/students/announcements/:announcementId/read
// @access  Private/Student
exports.markAnnouncementRead = async (req, res, next) => {
  try {
    const { announcementId } = req.params;
    const userId = req.user.id;

    const announcement = await Announcement.findById(announcementId);
    if (!announcement) {
      throw new NotFoundError('Announcement');
    }

    const read = await AnnouncementRead.findOneAndUpdate(
      { userId, announcementId },
      { readAt: new Date() },
      { upsert: true, new: true }
    );

    res.status(200).json({ success: true, data: read });
  } catch (error) {
    next(error);
  }
};

// @desc    Get course resume info
// @route   GET /api/students/courses/:courseId/resume
// @access  Private/Student
exports.getCourseResume = async (req, res, next) => {
  try {
    const { courseId } = req.params;
    const userId = req.user.id;
    const user = await User.findById(userId).populate('batchId');
    const course = await Course.findById(courseId);

    if (!course) throw new NotFoundError('Course');
    assertCourseAccess(user, course);

    const progress = await Progress.findOne({ userId, courseId });
    const continueLesson = findContinueLesson(course, progress);

    res.status(200).json({
      success: true,
      data: {
        lastAccessedLessonId: progress?.lastAccessedLessonId || null,
        continueLesson,
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get learning calendar events
// @route   GET /api/students/calendar
// @access  Private/Student
exports.getLearningCalendar = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const user = await User.findById(userId).populate('batchId');
    const courseQuery = buildAssignedCoursesQuery(user);

    if (!courseQuery) {
      return res.status(200).json({ success: true, data: [] });
    }

    const courses = await Course.find(courseQuery).select('_id title');
    const courseIds = courses.map((c) => c._id);

    const assessments = await Assessment.find({
      courseId: { $in: courseIds },
      visibility: 'published',
      $or: [{ startDate: { $ne: null } }, { endDate: { $ne: null } }],
    }).populate('courseId', 'title');

    const announcements = await Announcement.find(buildAnnouncementFilter(user))
      .select('title scheduledAt expiresAt createdAt pinned');

    const events = [
      ...assessments.flatMap((a) => {
        const items = [];
        if (a.startDate) {
          items.push({
            type: 'assessment_start',
            title: `${a.title} opens`,
            date: a.startDate,
            courseTitle: a.courseId?.title,
            assessmentId: a._id,
          });
        }
        if (a.endDate) {
          items.push({
            type: 'assessment_end',
            title: `${a.title} due`,
            date: a.endDate,
            courseTitle: a.courseId?.title,
            assessmentId: a._id,
          });
        }
        return items;
      }),
      ...announcements.map((a) => ({
        type: 'announcement',
        title: a.title,
        date: a.scheduledAt || a.createdAt,
        announcementId: a._id,
        pinned: a.pinned,
      })),
    ].sort((a, b) => new Date(a.date) - new Date(b.date));

    res.status(200).json({ success: true, data: events });
  } catch (error) {
    next(error);
  }
};

// @desc    List lesson bookmarks
// @route   GET /api/students/bookmarks
// @access  Private/Student
exports.getBookmarks = async (req, res, next) => {
  try {
    const bookmarks = await LessonBookmark.find({ userId: req.user.id }).sort({ updatedAt: -1 });
    res.status(200).json({ success: true, data: bookmarks });
  } catch (error) {
    next(error);
  }
};

// @desc    Toggle lesson bookmark
// @route   POST /api/students/bookmarks
// @access  Private/Student
exports.toggleBookmark = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { courseId, lessonId, lessonTitle, courseTitle } = req.body;

    if (!courseId || !lessonId) {
      return res.status(400).json({ success: false, error: 'courseId and lessonId are required' });
    }

    const existing = await LessonBookmark.findOne({ userId, lessonId });
    if (existing) {
      await existing.deleteOne();
      return res.status(200).json({ success: true, data: { bookmarked: false } });
    }

    await LessonBookmark.create({ userId, courseId, lessonId, lessonTitle, courseTitle });
    res.status(201).json({ success: true, data: { bookmarked: true } });
  } catch (error) {
    next(error);
  }
};

// @desc    Get/save lesson note
// @route   GET/PUT /api/students/courses/:courseId/lessons/:lessonId/note
// @access  Private/Student
exports.getLessonNote = async (req, res, next) => {
  try {
    const { courseId, lessonId } = req.params;
    const note = await LessonNote.findOne({ userId: req.user.id, lessonId, courseId });
    res.status(200).json({ success: true, data: note || { content: '' } });
  } catch (error) {
    next(error);
  }
};

exports.saveLessonNote = async (req, res, next) => {
  try {
    const { courseId, lessonId } = req.params;
    const { content = '' } = req.body;

    const note = await LessonNote.findOneAndUpdate(
      { userId: req.user.id, lessonId, courseId },
      { content },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    res.status(200).json({ success: true, data: note });
  } catch (error) {
    next(error);
  }
};

// @desc    Get student profile summary
// @route   GET /api/students/profile
// @access  Private/Student
exports.getProfile = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id).populate('batchId', 'name isActive').select('-password');
    if (!user) throw new NotFoundError('User');

    const preferences = await NotificationPreference.findOne({ userId: user._id });
    const progressRows = await Progress.find({ userId: user._id });
    const completedCourses = progressRows.filter((p) => p.completed).length;

    res.status(200).json({
      success: true,
      data: {
        user,
        notificationPreferences: preferences,
        stats: {
          completedCourses,
          currentStreakDays: Math.max(...progressRows.map((p) => p.currentStreakDays || 0), 0),
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

