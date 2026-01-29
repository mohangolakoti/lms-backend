const Course = require('../models/Course');
const Progress = require('../models/Progress');
const Assessment = require('../models/Assessment');
const Submission = require('../models/Submission');
const User = require('../models/User');

// @desc    Get instructor dashboard
// @route   GET /api/instructors/dashboard
// @access  Private/Instructor
exports.getDashboard = async (req, res, next) => {
  try {
    const instructorId = req.user.id;

    const courses = await Course.find({ instructorId });
    const totalCourses = courses.length;
    const publishedCourses = courses.filter(c => c.visibility === 'published').length;

    // Get student progress for instructor's courses
    const courseIds = courses.map(c => c._id);
    const progressData = await Progress.find({ courseId: { $in: courseIds } });
    const totalStudents = new Set(progressData.map(p => p.userId.toString())).size;
    const completedStudents = progressData.filter(p => p.completed).length;

    res.status(200).json({
      success: true,
      data: {
        courses: {
          totalCourses,
          publishedCourses,
          draftCourses: totalCourses - publishedCourses,
        },
        students: {
          totalStudents,
          completedStudents,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get instructor's courses
// @route   GET /api/instructors/courses
// @access  Private/Instructor
exports.getCourses = async (req, res, next) => {
  try {
    const courses = await Course.find({ instructorId: req.user.id })
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      data: courses,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Create course
// @route   POST /api/instructors/courses
// @access  Private/Instructor
exports.createCourse = async (req, res, next) => {
  try {
    const course = await Course.create({
      ...req.body,
      instructorId: req.user.id,
    });

    res.status(201).json({
      success: true,
      data: course,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Update course
// @route   PUT /api/instructors/courses/:id
// @access  Private/Instructor
exports.updateCourse = async (req, res, next) => {
  try {
    const course = await Course.findById(req.params.id);

    if (!course) {
      return res.status(404).json({
        success: false,
        error: 'Course not found',
      });
    }

    // Check ownership
    if (course.instructorId.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        error: 'Not authorized to update this course',
      });
    }

    Object.assign(course, req.body);
    await course.save();

    res.status(200).json({
      success: true,
      data: course,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Add module to course
// @route   POST /api/instructors/courses/:id/modules
// @access  Private/Instructor
exports.addModule = async (req, res, next) => {
  try {
    const course = await Course.findById(req.params.id);

    if (!course) {
      return res.status(404).json({
        success: false,
        error: 'Course not found',
      });
    }

    if (course.instructorId.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        error: 'Not authorized',
      });
    }

    const maxOrder = course.modules.length > 0
      ? Math.max(...course.modules.map(m => m.order))
      : 0;

    course.modules.push({
      ...req.body,
      order: req.body.order || maxOrder + 1,
      lessons: [],
    });

    await course.save();

    res.status(201).json({
      success: true,
      data: course,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Update module
// @route   PUT /api/instructors/courses/:courseId/modules/:moduleId
// @access  Private/Instructor
exports.updateModule = async (req, res, next) => {
  try {
    const course = await Course.findById(req.params.courseId);

    if (!course) {
      return res.status(404).json({
        success: false,
        error: 'Course not found',
      });
    }

    if (course.instructorId.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        error: 'Not authorized',
      });
    }

    const module = course.modules.id(req.params.moduleId);
    if (!module) {
      return res.status(404).json({
        success: false,
        error: 'Module not found',
      });
    }

    Object.assign(module, req.body);
    await course.save();

    res.status(200).json({
      success: true,
      data: course,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Delete module
// @route   DELETE /api/instructors/courses/:courseId/modules/:moduleId
// @access  Private/Instructor
exports.deleteModule = async (req, res, next) => {
  try {
    const course = await Course.findById(req.params.courseId);

    if (!course) {
      return res.status(404).json({
        success: false,
        error: 'Course not found',
      });
    }

    if (course.instructorId.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        error: 'Not authorized',
      });
    }

    course.modules.id(req.params.moduleId).deleteOne();
    await course.save();

    res.status(200).json({
      success: true,
      data: course,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Add lesson to module
// @route   POST /api/instructors/courses/:courseId/modules/:moduleId/lessons
// @access  Private/Instructor
exports.addLesson = async (req, res, next) => {
  try {
    const course = await Course.findById(req.params.courseId);

    if (!course) {
      return res.status(404).json({
        success: false,
        error: 'Course not found',
      });
    }

    if (course.instructorId.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        error: 'Not authorized',
      });
    }

    const module = course.modules.id(req.params.moduleId);
    if (!module) {
      return res.status(404).json({
        success: false,
        error: 'Module not found',
      });
    }

    const maxOrder = module.lessons.length > 0
      ? Math.max(...module.lessons.map(l => l.order))
      : 0;

    module.lessons.push({
      ...req.body,
      order: req.body.order || maxOrder + 1,
    });

    await course.save();

    res.status(201).json({
      success: true,
      data: course,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Update lesson
// @route   PUT /api/instructors/courses/:courseId/modules/:moduleId/lessons/:lessonId
// @access  Private/Instructor
exports.updateLesson = async (req, res, next) => {
  try {
    const course = await Course.findById(req.params.courseId);

    if (!course) {
      return res.status(404).json({
        success: false,
        error: 'Course not found',
      });
    }

    if (course.instructorId.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        error: 'Not authorized',
      });
    }

    const module = course.modules.id(req.params.moduleId);
    if (!module) {
      return res.status(404).json({
        success: false,
        error: 'Module not found',
      });
    }

    const lesson = module.lessons.id(req.params.lessonId);
    if (!lesson) {
      return res.status(404).json({
        success: false,
        error: 'Lesson not found',
      });
    }

    Object.assign(lesson, req.body);
    await course.save();

    res.status(200).json({
      success: true,
      data: course,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Delete lesson
// @route   DELETE /api/instructors/courses/:courseId/modules/:moduleId/lessons/:lessonId
// @access  Private/Instructor
exports.deleteLesson = async (req, res, next) => {
  try {
    const course = await Course.findById(req.params.courseId);

    if (!course) {
      return res.status(404).json({
        success: false,
        error: 'Course not found',
      });
    }

    if (course.instructorId.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        error: 'Not authorized',
      });
    }

    const module = course.modules.id(req.params.moduleId);
    if (!module) {
      return res.status(404).json({
        success: false,
        error: 'Module not found',
      });
    }

    module.lessons.id(req.params.lessonId).deleteOne();
    await course.save();

    res.status(200).json({
      success: true,
      data: course,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Create assessment
// @route   POST /api/instructors/assessments
// @access  Private/Instructor
exports.createAssessment = async (req, res, next) => {
  try {
    // Defensive check: Ensure courseId is provided and not empty
    if (!req.body.courseId || req.body.courseId.toString().trim() === '') {
      return res.status(400).json({
        success: false,
        error: 'Course ID is required',
      });
    }

    // Verify course exists and belongs to instructor
    const course = await Course.findById(req.body.courseId);
    if (!course) {
      return res.status(404).json({
        success: false,
        error: 'Course not found. Please select a valid course.',
      });
    }

    if (course.instructorId.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        error: 'Not authorized to create assessment for this course',
      });
    }

    // Add order to questions if not provided
    const assessmentData = {
      ...req.body,
      createdBy: req.user.id,
    };

    if (assessmentData.questions && Array.isArray(assessmentData.questions)) {
      assessmentData.questions = assessmentData.questions.map((q, index) => ({
        ...q,
        order: q.order !== undefined ? q.order : index,
      }));
    }

    const assessment = await Assessment.create(assessmentData);

    res.status(201).json({
      success: true,
      data: assessment,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get assessments for instructor's courses
// @route   GET /api/instructors/assessments
// @access  Private/Instructor
exports.getAssessments = async (req, res, next) => {
  try {
    const courses = await Course.find({ instructorId: req.user.id });
    const courseIds = courses.map(c => c._id);

    const assessments = await Assessment.find({ courseId: { $in: courseIds } })
      .populate('courseId', 'title')
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      data: assessments,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get student progress for course
// @route   GET /api/instructors/courses/:courseId/progress
// @access  Private/Instructor
exports.getCourseProgress = async (req, res, next) => {
  try {
    const { courseId } = req.params;

    const course = await Course.findById(courseId);
    if (!course) {
      return res.status(404).json({
        success: false,
        error: 'Course not found',
      });
    }

    if (course.instructorId.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        error: 'Not authorized',
      });
    }

    const progressData = await Progress.find({ courseId })
      .populate('userId', 'name email batch');

    res.status(200).json({
      success: true,
      data: progressData,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get submissions for assessment
// @route   GET /api/instructors/assessments/:assessmentId/submissions
// @access  Private/Instructor
exports.getSubmissions = async (req, res, next) => {
  try {
    const { assessmentId } = req.params;

    const assessment = await Assessment.findById(assessmentId);
    if (!assessment) {
      return res.status(404).json({
        success: false,
        error: 'Assessment not found',
      });
    }

    const course = await Course.findById(assessment.courseId);
    if (!course || course.instructorId.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        error: 'Not authorized',
      });
    }

    const submissions = await Submission.find({ assessmentId })
      .populate('userId', 'name email batch')
      .sort({ submittedAt: -1 });

    res.status(200).json({
      success: true,
      data: {
        assessment: {
          _id: assessment._id,
          title: assessment.title,
          description: assessment.description,
          duration: assessment.duration,
          totalMarks: assessment.totalMarks,
          passingMarks: assessment.passingMarks,
          questions: assessment.questions,
        },
        submissions,
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Grade submission
// @route   PUT /api/instructors/submissions/:submissionId/grade
// @access  Private/Instructor
exports.gradeSubmission = async (req, res, next) => {
  try {
    const { submissionId } = req.params;
    const { feedback } = req.body;

    const submission = await Submission.findById(submissionId)
      .populate('assessmentId');

    if (!submission) {
      return res.status(404).json({
        success: false,
        error: 'Submission not found',
      });
    }

    const assessment = submission.assessmentId;
    const course = await Course.findById(assessment.courseId);

    if (!course || course.instructorId.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        error: 'Not authorized',
      });
    }

    if (feedback !== undefined) {
      submission.feedback = feedback;
    }

    submission.gradedBy = req.user.id;
    submission.gradedAt = Date.now();
    await submission.save();

    res.status(200).json({
      success: true,
      data: submission,
    });
  } catch (error) {
    next(error);
  }
};


