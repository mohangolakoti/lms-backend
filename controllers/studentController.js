const Course = require('../models/Course');
const Progress = require('../models/Progress');
const Assessment = require('../models/Assessment');
const Submission = require('../models/Submission');
const Announcement = require('../models/Announcement');
const Notification = require('../models/Notification');
const User = require('../models/User');

// @desc    Get student dashboard
// @route   GET /api/students/dashboard
// @access  Private/Student
exports.getDashboard = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const user = await User.findById(userId).populate('batchId');

    // Check if student has batchId assigned
    if (!user.batchId) {
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
            totalAssessments: 0,
            completedAssessments: 0,
            totalQuestionsAttempted: 0,
          },
        },
      });
    }

    // Get courses assigned to student based on batch AND term
    const courses = await Course.find({
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
    }).populate('instructorId', 'name email');

    // Get progress for all courses
    const progressData = await Progress.find({ userId });

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
        
        const moduleCount = course.modules.length;
        totalModules += moduleCount;
        
        const completedModuleCount = progress.moduleProgress.filter(
          mp => mp.completionPercentage === 100
        ).length;
        completedModules += completedModuleCount;
      }

      return {
        courseId: course._id,
        title: course.title,
        thumbnailUrl: course.thumbnailUrl,
        level: course.level,
        instructor: course.instructorId.name,
        progress: progress ? progress.overallCoursePercentage : 0,
        completed: progress ? progress.completed : false,
      };
    });

    // Get assessments for assigned courses
    const courseIds = courses.map(c => c._id);
    const assessments = await Assessment.find({
      courseId: { $in: courseIds },
      visibility: 'published',
    });

    totalAssessments = assessments.length;

    // Get submissions
    const submissions = await Submission.find({ userId });
    completedAssessments = submissions.length;
    
    submissions.forEach(submission => {
      totalQuestionsAttempted += submission.answers.length;
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
          totalTimeSpent: Math.round(totalTimeSpent / 60), // Convert to minutes
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
    const { NotFoundError, ForbiddenError, ValidationError } = require('../utils/errors');

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

    // Check batch access
    if (!user.batchId) {
      throw new ForbiddenError('No batch assigned. Unable to access courses.');
    }

    // Verify term match
    const termMatch = course.term === user.batch || course.term === 'both';
    if (!termMatch) {
      throw new ForbiddenError('Course not available for your batch term');
    }

    // Verify batch is in course batches
    const batchInCourse = course.batches.some(b => b._id.toString() === user.batchId._id.toString());
    if (!batchInCourse) {
      throw new ForbiddenError('You do not have access to this course');
    }

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

    // Build modules with progress
    const modulesWithProgress = course.modules.map(module => {
      const moduleProg = progress.moduleProgress.find(
        mp => mp.moduleId.toString() === module._id.toString()
      );

      const lessonsWithProgress = module.lessons.map(lesson => {
        const lessonProg = progress.lessonProgress.find(
          lp => lp.lessonId.toString() === lesson._id.toString()
        );

        return {
          ...lesson.toObject(),
          completed: lessonProg ? lessonProg.completed : false,
          lastWatchedSecond: lessonProg ? lessonProg.lastWatchedSecond : 0,
        };
      });

      return {
        ...module.toObject(),
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
        progress.lessonProgress[lessonProgIndex].lastWatchedSecond = lastWatchedSecond;
      }
    } else {
      previousTime = 0;
      progress.lessonProgress.push({
        lessonId,
        completed: completed || false,
        lastWatchedSecond: lastWatchedSecond || 0,
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
        (completedLessons.length / lessonModule.lessons.length) * 100;
    }

    // Calculate overall course percentage
    const totalLessons = course.modules.reduce((sum, m) => sum + m.lessons.length, 0);
    const completedLessonsCount = progress.lessonProgress.filter(lp => lp.completed).length;
    progress.overallCoursePercentage = (completedLessonsCount / totalLessons) * 100;

    // Update time spent if provided
    if (lastWatchedSecond !== undefined) {
      const timeDiff = lastWatchedSecond - previousTime;
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
    const user = await User.findById(userId);

    // Get assigned courses
    const courses = await Course.find({
      $or: [
        { term: user.batch },
        { term: 'both' },
      ],
      visibility: 'published',
    });

    const courseIds = courses.map(c => c._id);

    const assessments = await Assessment.find({
      courseId: { $in: courseIds },
      visibility: 'published',
    })
      .populate('courseId', 'title')
      .populate('createdBy', 'name');

    // Get submissions
    const submissions = await Submission.find({ userId });

    const assessmentsWithStatus = assessments.map(assessment => {
      const submission = submissions.find(
        s => s.assessmentId.toString() === assessment._id.toString()
      );

      return {
        ...assessment.toObject(),
        submitted: !!submission,
        submission: submission ? {
          score: submission.score,
          percentage: submission.percentage,
          passed: submission.passed,
          submittedAt: submission.submittedAt,
          answers: submission.answers, // Include answers for result display
        } : null,
      };
    });

    res.status(200).json({
      success: true,
      data: assessmentsWithStatus,
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

    const assessment = await Assessment.findById(assessmentId);
    if (!assessment) {
      return res.status(404).json({
        success: false,
        error: 'Assessment not found',
      });
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
    const processedAnswers = answers.map((answer, index) => {
      // Convert questionId to number for array indexing
      const questionIndex = parseInt(answer.questionId);
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

    const submission = await Submission.create({
      userId,
      assessmentId,
      answers: processedAnswers,
      score,
      totalMarks: assessment.totalMarks,
      percentage,
      passed,
      timeTaken,
    });

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

    const announcementFilter = {
      $or: [
        { targetType: 'global' },
      ],
    };

    if (user.batchId) {
      announcementFilter.$or.push({
        targetType: 'batch',
        batchIds: user.batchId,
      });
    }

    const announcements = await Announcement.find(announcementFilter)
      .populate('createdBy', 'name')
      .populate('batchIds', 'name')
      .sort({ createdAt: -1 });

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
    const { read } = req.query;

    const query = { userId };
    if (read !== undefined) {
      query.read = read === 'true';
    }

    const notifications = await Notification.find(query)
      .sort({ createdAt: -1 })
      .limit(50);

    res.status(200).json({
      success: true,
      data: notifications,
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

