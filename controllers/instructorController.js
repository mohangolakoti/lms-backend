const Course = require('../models/Course');
const Progress = require('../models/Progress');
const Assessment = require('../models/Assessment');
const Submission = require('../models/Submission');
const User = require('../models/User');
const CourseInstructor = require('../models/CourseInstructor');
const Batch = require('../models/Batch');
const {
  getCourseRoleForUser,
  getCourseAssignmentsMap,
  normalizeAssignments,
  buildPrimaryInstructorId,
  hasAtLeastOneEditor,
  syncCourseInstructors,
} = require('../utils/courseInstructorService');

const getAssignedCourseIds = async (userId) => {
  const assignments = await CourseInstructor.find({ instructor_id: userId }).select('course_id');
  return assignments.map((item) => item.course_id);
};

const getCourseAccessRole = async (course, req) => {
  return getCourseRoleForUser({
    courseId: course._id,
    userId: req.user.id,
    fallbackInstructorId: course.instructorId,
    userRole: req.user.role,
  });
};

const ensureCourseAccess = async ({ course, req, requireEditor = false, errorMessage = 'Not authorized' }) => {
  const role = await getCourseAccessRole(course, req);

  if (!role) {
    return {
      ok: false,
      status: 403,
      payload: {
        success: false,
        error: errorMessage,
      },
    };
  }

  if (requireEditor && role !== 'editor') {
    return {
      ok: false,
      status: 403,
      payload: {
        success: false,
        error: 'Only editor instructors can modify this course',
      },
    };
  }

  return { ok: true, role };
};

const normalizeModuleOrders = (course, moduleOrder = []) => {
  const orderMap = new Map(moduleOrder.map((item, index) => [String(item), index + 1]));

  course.modules.forEach((module, index) => {
    const mappedOrder = orderMap.get(String(module._id));
    module.order = mappedOrder || (index + 1);
  });

  course.modules.sort((a, b) => a.order - b.order);
};

const normalizeLessonOrders = (module, lessonOrder = []) => {
  const orderMap = new Map(lessonOrder.map((item, index) => [String(item), index + 1]));

  module.lessons.forEach((lesson, index) => {
    const mappedOrder = orderMap.get(String(lesson._id));
    lesson.order = mappedOrder || (index + 1);
  });

  module.lessons.sort((a, b) => a.order - b.order);
};

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
    status: 'active',
  }).select('_id');

  if (instructors.length !== assignments.length) {
    return 'One or more assigned instructors are invalid';
  }

  return null;
};

const ALLOWED_MODULE_FIELDS = new Set(['title', 'order']);
const ALLOWED_LESSON_FIELDS = new Set([
  'title',
  'description',
  'type',
  'url',
  'durationSeconds',
  'resources',
  'order',
]);

const pickAllowedFields = (payload = {}, allowSet) => {
  return Object.entries(payload).reduce((acc, [key, value]) => {
    if (allowSet.has(key)) {
      acc[key] = value;
    }
    return acc;
  }, {});
};

const validateReorderIds = (existingIds = [], reorderedIds = [], label = 'items') => {
  const existing = existingIds.map(String);
  const incoming = reorderedIds.map(String);

  if (existing.length !== incoming.length) {
    return `${label} reorder list must include every ${label.slice(0, -1)} exactly once`;
  }

  const incomingSet = new Set(incoming);
  if (incomingSet.size !== incoming.length) {
    return `${label} reorder list contains duplicate IDs`;
  }

  const hasAll = existing.every((id) => incomingSet.has(id));
  if (!hasAll) {
    return `${label} reorder list contains invalid IDs`;
  }

  return null;
};

const normalizeSiblingOrder = (items = [], targetId, desiredOrder) => {
  const normalizedDesiredOrder = Number.isFinite(Number(desiredOrder)) ? Number(desiredOrder) : null;
  if (!normalizedDesiredOrder || !Array.isArray(items) || items.length === 0) {
    return;
  }

  const sorted = [...items].sort((a, b) => a.order - b.order);
  const targetIndex = sorted.findIndex((item) => item._id.toString() === targetId.toString());
  if (targetIndex < 0) {
    return;
  }

  const [target] = sorted.splice(targetIndex, 1);
  const boundedOrder = Math.min(Math.max(normalizedDesiredOrder, 1), sorted.length + 1);
  sorted.splice(boundedOrder - 1, 0, target);
  sorted.forEach((item, index) => {
    item.order = index + 1;
  });
};

const enrichCourseWithRole = async (course, userId, userRole) => {
  const assignmentsMap = await getCourseAssignmentsMap([course._id]);
  const assignments = assignmentsMap.get(course._id.toString()) || [];
  const me = assignments.find((item) => item.instructorId?._id?.toString() === userId);
  const courseObj = course.toObject ? course.toObject() : course;

  return {
    ...courseObj,
    instructorRole: userRole === 'admin'
      ? 'editor'
      : (me?.role || (course.instructorId?.toString() === userId ? 'editor' : 'viewer')),
    courseInstructors: assignments,
  };
};

const buildHydratedCourseProgress = async (course) => {
  const progressData = await Progress.find({ courseId: course._id })
    .populate('userId', 'name email batch status approvalStatus batchBlocked');

  const enrolledStudents = await User.find({
    role: 'student',
    approvalStatus: 'approved',
    status: 'active',
    batchBlocked: false,
    batchId: { $in: course.batches || [] },
  }).select('_id name email batch status approvalStatus batchBlocked');

  const progressByUserId = new Map(progressData.map((item) => [item.userId?._id?.toString(), item]));

  return enrolledStudents.map((student) => {
    const existing = progressByUserId.get(student._id.toString());
    if (existing) {
      return existing;
    }

    return {
      userId: student,
      courseId: course._id,
      moduleProgress: [],
      lessonProgress: [],
      totalTimeSpent: 0,
      overallCoursePercentage: 0,
      lastAccessed: null,
      completed: false,
      completedAt: null,
    };
  });
};

const filterProgressRows = (rows, { status, search, batch }) => {
  let filtered = rows;

  if (status === 'completed') {
    filtered = filtered.filter((row) => row.completed);
  } else if (status === 'in_progress') {
    filtered = filtered.filter((row) => !row.completed && ((row.overallCoursePercentage || 0) > 0 || row.lastAccessed));
  } else if (status === 'not_started') {
    filtered = filtered.filter((row) => !row.completed && !(row.overallCoursePercentage || 0) && !row.lastAccessed);
  }

  if (batch) {
    filtered = filtered.filter((row) => row.userId?.batch === batch);
  }

  if (search) {
    const term = search.toLowerCase();
    filtered = filtered.filter((row) => {
      const name = row.userId?.name?.toLowerCase() || '';
      const email = row.userId?.email?.toLowerCase() || '';
      return name.includes(term) || email.includes(term);
    });
  }

  return filtered;
};

const ALLOWED_COURSE_UPDATE_FIELDS = new Set([
  'title',
  'description',
  'term',
  'level',
  'thumbnailUrl',
  'visibility',
  'batches',
  'courseInstructors',
  'instructorId',
]);

// @desc    Get instructor dashboard
// @route   GET /api/instructors/dashboard
// @access  Private/Instructor
exports.getDashboard = async (req, res, next) => {
  try {
    const instructorId = req.user.id;
    const assignedCourseIds = await getAssignedCourseIds(instructorId);

    const courses = await Course.find({
      $or: [
        { _id: { $in: assignedCourseIds } },
        { instructorId },
      ],
    });
    const totalCourses = courses.length;
    const publishedCourses = courses.filter(c => c.visibility === 'published').length;

    // Get student progress for instructor's courses
    const courseIds = courses.map(c => c._id);
    const progressData = await Progress.find({ courseId: { $in: courseIds } });
    const totalStudents = new Set(progressData.map(p => p.userId.toString())).size;
    const completedStudents = progressData.filter(p => p.completed).length;

    const draftAssessments = await Assessment.countDocuments({
      courseId: { $in: courseIds },
      visibility: 'draft',
    });

    const instructorAssessments = await Assessment.find({ courseId: { $in: courseIds } }).select('_id');
    const assessmentIds = instructorAssessments.map((item) => item._id);
    const totalSubmissions = assessmentIds.length
      ? await Submission.countDocuments({ assessmentId: { $in: assessmentIds } })
      : 0;

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const atRiskStudents = progressData.filter((row) => {
      if (row.completed) return false;
      if ((row.overallCoursePercentage || 0) < 40) return true;
      if (!row.lastAccessed) return true;
      return new Date(row.lastAccessed) < sevenDaysAgo;
    }).length;

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
          atRiskStudents,
        },
        assessments: {
          draftAssessments,
          totalSubmissions,
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
    const assignedCourseIds = await getAssignedCourseIds(req.user.id);

    const courses = await Course.find({
      $or: [
        { _id: { $in: assignedCourseIds } },
        { instructorId: req.user.id },
      ],
    })
      .populate('batches', 'name isActive')
      .sort({ createdAt: -1 });

    const responseCourses = await Promise.all(
      courses.map((course) => enrichCourseWithRole(course, req.user.id, req.user.role))
    );

    res.status(200).json({
      success: true,
      data: responseCourses,
      count: responseCourses.length,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get single course by ID
// @route   GET /api/instructors/courses/:id
// @access  Private/Instructor
exports.getCourseById = async (req, res, next) => {
  try {
    const course = await Course.findById(req.params.id).populate('batches', 'name isActive');

    if (!course) {
      return res.status(404).json({
        success: false,
        error: 'Course not found',
      });
    }

    const access = await ensureCourseAccess({ course, req });
    if (!access.ok) {
      return res.status(access.status).json(access.payload);
    }

    const enriched = await enrichCourseWithRole(course, req.user.id, req.user.role);

    return res.status(200).json({
      success: true,
      data: enriched,
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
    const { batches, courseInstructors, ...courseData } = req.body;

    // Validate batches
    if (!batches || !Array.isArray(batches) || batches.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'At least one batch must be assigned',
      });
    }

    // Verify all batches exist
    const existingBatches = await Batch.find({ _id: { $in: batches } });

    if (existingBatches.length !== batches.length) {
      return res.status(400).json({
        success: false,
        error: 'One or more batches do not exist',
      });
    }

    const normalizedAssignments = normalizeAssignments(courseInstructors, req.user.id);
    const assignmentError = await validateInstructorAssignments(normalizedAssignments);
    if (assignmentError) {
      return res.status(400).json({
        success: false,
        error: assignmentError,
      });
    }

    const course = await Course.create({
      ...courseData,
      batches,
      instructorId: buildPrimaryInstructorId(normalizedAssignments, req.user.id),
    });

    await syncCourseInstructors(course._id, normalizedAssignments);

    await course.populate('batches', 'name isActive');

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
    const invalidFields = Object.keys(req.body || {}).filter((field) => !ALLOWED_COURSE_UPDATE_FIELDS.has(field));
    if (invalidFields.length > 0) {
      return res.status(400).json({
        success: false,
        error: `Unsupported course update fields: ${invalidFields.join(', ')}`,
      });
    }

    const course = await Course.findById(req.params.id);

    if (!course) {
      return res.status(404).json({
        success: false,
        error: 'Course not found',
      });
    }

    const access = await ensureCourseAccess({
      course,
      req,
      requireEditor: true,
      errorMessage: 'Not authorized to update this course',
    });
    if (!access.ok) {
      return res.status(access.status).json(access.payload);
    }

    const { courseInstructors, instructorId, ...updateData } = req.body;

    if (updateData.batches !== undefined) {
      if (!Array.isArray(updateData.batches) || updateData.batches.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'At least one batch must be assigned',
        });
      }
      const uniqueBatchIds = [...new Set(updateData.batches.map((id) => String(id)))];
      const existingBatches = await Batch.find({
        _id: { $in: uniqueBatchIds },
        isActive: true,
        isDeleted: false,
      }).select('_id');
      if (existingBatches.length !== uniqueBatchIds.length) {
        return res.status(400).json({
          success: false,
          error: 'One or more selected batches are invalid or inactive',
        });
      }
    }

    let normalizedAssignments = null;
    if (courseInstructors !== undefined || instructorId !== undefined) {
      normalizedAssignments = normalizeAssignments(courseInstructors, instructorId || course.instructorId);
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

    const access = await ensureCourseAccess({ course, req, requireEditor: true });
    if (!access.ok) {
      return res.status(access.status).json(access.payload);
    }

    const maxOrder = course.modules.length > 0
      ? Math.max(...course.modules.map(m => m.order))
      : 0;
    const modulePayload = pickAllowedFields(req.body, ALLOWED_MODULE_FIELDS);

    course.modules.push({
      ...modulePayload,
      order: modulePayload.order || maxOrder + 1,
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

    const access = await ensureCourseAccess({ course, req, requireEditor: true });
    if (!access.ok) {
      return res.status(access.status).json(access.payload);
    }

    const module = course.modules.id(req.params.moduleId);
    if (!module) {
      return res.status(404).json({
        success: false,
        error: 'Module not found',
      });
    }

    const modulePayload = pickAllowedFields(req.body, ALLOWED_MODULE_FIELDS);
    const { order, ...restModulePayload } = modulePayload;
    Object.assign(module, restModulePayload);
    if (order !== undefined) {
      normalizeSiblingOrder(course.modules, module._id, order);
    }
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

    const access = await ensureCourseAccess({ course, req, requireEditor: true });
    if (!access.ok) {
      return res.status(access.status).json(access.payload);
    }

    const module = course.modules.id(req.params.moduleId);
    if (!module) {
      return res.status(404).json({
        success: false,
        error: 'Module not found',
      });
    }

    module.deleteOne();
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

    const access = await ensureCourseAccess({ course, req, requireEditor: true });
    if (!access.ok) {
      return res.status(access.status).json(access.payload);
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
    const lessonPayload = pickAllowedFields(req.body, ALLOWED_LESSON_FIELDS);

    module.lessons.push({
      ...lessonPayload,
      order: lessonPayload.order || maxOrder + 1,
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

    const access = await ensureCourseAccess({ course, req, requireEditor: true });
    if (!access.ok) {
      return res.status(access.status).json(access.payload);
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

    const lessonPayload = pickAllowedFields(req.body, ALLOWED_LESSON_FIELDS);
    const { order, ...restLessonPayload } = lessonPayload;
    Object.assign(lesson, restLessonPayload);
    if (order !== undefined) {
      normalizeSiblingOrder(module.lessons, lesson._id, order);
    }
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

    const access = await ensureCourseAccess({ course, req, requireEditor: true });
    if (!access.ok) {
      return res.status(access.status).json(access.payload);
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

    lesson.deleteOne();
    await course.save();

    res.status(200).json({
      success: true,
      data: course,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Reorder modules in a course
// @route   PUT /api/instructors/courses/:courseId/modules/reorder
// @access  Private/Instructor
exports.reorderModules = async (req, res, next) => {
  try {
    const { courseId } = req.params;
    const { moduleOrder } = req.body;

    if (!Array.isArray(moduleOrder) || moduleOrder.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'moduleOrder must be a non-empty array',
      });
    }

    const course = await Course.findById(courseId);
    if (!course) {
      return res.status(404).json({
        success: false,
        error: 'Course not found',
      });
    }

    const access = await ensureCourseAccess({ course, req, requireEditor: true });
    if (!access.ok) {
      return res.status(access.status).json(access.payload);
    }

    const reorderValidationError = validateReorderIds(
      course.modules.map((module) => module._id),
      moduleOrder,
      'modules'
    );
    if (reorderValidationError) {
      return res.status(400).json({
        success: false,
        error: reorderValidationError,
      });
    }

    normalizeModuleOrders(course, moduleOrder);
    await course.save();

    return res.status(200).json({
      success: true,
      data: course,
      message: 'Modules reordered successfully',
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Reorder lessons in a module
// @route   PUT /api/instructors/courses/:courseId/modules/:moduleId/lessons/reorder
// @access  Private/Instructor
exports.reorderLessons = async (req, res, next) => {
  try {
    const { courseId, moduleId } = req.params;
    const { lessonOrder } = req.body;

    if (!Array.isArray(lessonOrder) || lessonOrder.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'lessonOrder must be a non-empty array',
      });
    }

    const course = await Course.findById(courseId);
    if (!course) {
      return res.status(404).json({
        success: false,
        error: 'Course not found',
      });
    }

    const access = await ensureCourseAccess({ course, req, requireEditor: true });
    if (!access.ok) {
      return res.status(access.status).json(access.payload);
    }

    const module = course.modules.id(moduleId);
    if (!module) {
      return res.status(404).json({
        success: false,
        error: 'Module not found',
      });
    }

    const reorderValidationError = validateReorderIds(
      module.lessons.map((lesson) => lesson._id),
      lessonOrder,
      'lessons'
    );
    if (reorderValidationError) {
      return res.status(400).json({
        success: false,
        error: reorderValidationError,
      });
    }

    normalizeLessonOrders(module, lessonOrder);
    await course.save();

    return res.status(200).json({
      success: true,
      data: course,
      message: 'Lessons reordered successfully',
    });
  } catch (error) {
    next(error);
  }
};

const sanitizeAssessmentQuestions = (questions = []) => {
  return questions.map((question) => ({
    question: question.question,
    type: question.type,
    options: question.options,
    marks: question.marks,
    order: question.order,
  }));
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

    const access = await ensureCourseAccess({
      course,
      req,
      requireEditor: true,
      errorMessage: 'Not authorized to create assessment for this course',
    });
    if (!access.ok) {
      return res.status(access.status).json(access.payload);
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

// @desc    Update assessment
// @route   PUT /api/instructors/assessments/:assessmentId
// @access  Private/Instructor
exports.updateAssessment = async (req, res, next) => {
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
    if (!course) {
      return res.status(404).json({
        success: false,
        error: 'Course not found',
      });
    }

    const access = await ensureCourseAccess({ course, req, requireEditor: true });
    if (!access.ok) {
      return res.status(access.status).json(access.payload);
    }

    const allowedFields = [
      'title',
      'description',
      'duration',
      'totalMarks',
      'passingMarks',
      'visibility',
      'startDate',
      'endDate',
      'moduleId',
    ];
    const updates = pickAllowedFields(req.body, new Set(allowedFields));

    if (updates.moduleId) {
      const moduleExists = course.modules.some((module) => module._id.toString() === updates.moduleId.toString());
      if (!moduleExists) {
        return res.status(400).json({
          success: false,
          error: 'moduleId must reference a module in the selected course',
        });
      }
    }

    if (updates.passingMarks !== undefined || updates.totalMarks !== undefined) {
      const totalMarks = updates.totalMarks !== undefined ? Number(updates.totalMarks) : Number(assessment.totalMarks);
      const passingMarks = updates.passingMarks !== undefined ? Number(updates.passingMarks) : Number(assessment.passingMarks);
      if (passingMarks > totalMarks) {
        return res.status(400).json({
          success: false,
          error: 'passingMarks cannot exceed totalMarks',
        });
      }
    }

    Object.assign(assessment, updates);
    await assessment.save();

    return res.status(200).json({
      success: true,
      data: assessment,
      message: 'Assessment updated successfully',
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
    const { courseId, visibility } = req.query;
    const assignedCourseIds = await getAssignedCourseIds(req.user.id);
    const courses = await Course.find({
      $or: [
        { _id: { $in: assignedCourseIds } },
        { instructorId: req.user.id },
      ],
    });
    const courseIds = courses.map(c => c._id);

    const query = { courseId: { $in: courseIds } };
    if (courseId) {
      query.courseId = courseId;
    }
    if (visibility && ['published', 'draft'].includes(visibility)) {
      query.visibility = visibility;
    }

    const assessments = await Assessment.find(query)
      .populate('courseId', 'title')
      .sort({ createdAt: -1 });

    const roleByCourseId = new Map(
      (await Promise.all(courses.map((course) => enrichCourseWithRole(course, req.user.id, req.user.role))))
        .map((course) => [course._id.toString(), course.instructorRole])
    );

    const responseAssessments = assessments.map((assessment) => ({
      ...assessment.toObject(),
      instructorRole: roleByCourseId.get(assessment.courseId?._id?.toString() || assessment.courseId?.toString()) || 'viewer',
    }));

    res.status(200).json({
      success: true,
      data: responseAssessments,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Delete assessment
// @route   DELETE /api/instructors/assessments/:assessmentId
// @access  Private/Instructor
exports.deleteAssessment = async (req, res, next) => {
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
    if (!course) {
      return res.status(404).json({
        success: false,
        error: 'Course not found',
      });
    }

    const access = await ensureCourseAccess({ course, req, requireEditor: true });
    if (!access.ok) {
      return res.status(access.status).json(access.payload);
    }

    const submissionCount = await Submission.countDocuments({ assessmentId });
    if (submissionCount > 0) {
      return res.status(409).json({
        success: false,
        error: 'Cannot delete assessment with existing submissions',
      });
    }

    await assessment.deleteOne();

    return res.status(200).json({
      success: true,
      message: 'Assessment deleted successfully',
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Duplicate assessment
// @route   POST /api/instructors/assessments/:assessmentId/duplicate
// @access  Private/Instructor
exports.duplicateAssessment = async (req, res, next) => {
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
    if (!course) {
      return res.status(404).json({
        success: false,
        error: 'Course not found',
      });
    }

    const access = await ensureCourseAccess({ course, req, requireEditor: true });
    if (!access.ok) {
      return res.status(access.status).json(access.payload);
    }

    const clone = await Assessment.create({
      courseId: assessment.courseId,
      moduleId: assessment.moduleId,
      title: `${assessment.title} (Copy)`,
      description: assessment.description,
      questions: assessment.questions,
      duration: assessment.duration,
      totalMarks: assessment.totalMarks,
      passingMarks: assessment.passingMarks,
      startDate: assessment.startDate,
      endDate: assessment.endDate,
      visibility: 'draft',
      createdBy: req.user.id,
    });

    return res.status(201).json({
      success: true,
      data: clone,
      message: 'Assessment duplicated successfully',
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get analytics for a specific assessment
// @route   GET /api/instructors/assessments/:assessmentId/analytics
// @access  Private/Instructor
exports.getAssessmentAnalytics = async (req, res, next) => {
  try {
    const { assessmentId } = req.params;
    const assessment = await Assessment.findById(assessmentId).populate('courseId', 'title');

    if (!assessment) {
      return res.status(404).json({
        success: false,
        error: 'Assessment not found',
      });
    }

    const course = await Course.findById(assessment.courseId?._id || assessment.courseId);
    if (!course) {
      return res.status(403).json({
        success: false,
        error: 'Not authorized',
      });
    }

    const access = await ensureCourseAccess({ course, req });
    if (!access.ok) {
      return res.status(403).json({
        success: false,
        error: 'Not authorized',
      });
    }

    const submissions = await Submission.find({ assessmentId }).select('score totalMarks percentage passed timeTaken submittedAt');
    const totalAttempts = submissions.length;
    const passCount = submissions.filter((submission) => submission.passed).length;
    const failCount = totalAttempts - passCount;
    const averageScore = totalAttempts > 0
      ? submissions.reduce((sum, submission) => sum + (submission.percentage || 0), 0) / totalAttempts
      : 0;
    const averageTimeTaken = totalAttempts > 0
      ? submissions.reduce((sum, submission) => sum + (submission.timeTaken || 0), 0) / totalAttempts
      : 0;

    const attemptsByDay = submissions.reduce((acc, submission) => {
      const key = new Date(submission.submittedAt).toISOString().slice(0, 10);
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});

    return res.status(200).json({
      success: true,
      data: {
        assessment: {
          _id: assessment._id,
          title: assessment.title,
          courseTitle: assessment.courseId?.title || '',
          totalMarks: assessment.totalMarks,
          passingMarks: assessment.passingMarks,
        },
        totals: {
          totalAttempts,
          passCount,
          failCount,
          passRate: totalAttempts > 0 ? (passCount / totalAttempts) * 100 : 0,
          averageScore,
          averageTimeTakenSeconds: averageTimeTaken,
          averageTimeTakenMinutes: averageTimeTaken / 60,
        },
        trend: Object.entries(attemptsByDay)
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([date, attempts]) => ({ date, attempts })),
      },
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
    const { status, search, batch } = req.query;

    const course = await Course.findById(courseId);
    if (!course) {
      return res.status(404).json({
        success: false,
        error: 'Course not found',
      });
    }

    const access = await ensureCourseAccess({ course, req });
    if (!access.ok) {
      return res.status(access.status).json(access.payload);
    }

    const hydratedProgress = await buildHydratedCourseProgress(course);
    const filtered = filterProgressRows(hydratedProgress, { status, search, batch });

    res.status(200).json({
      success: true,
      data: filtered,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Export student progress CSV for course
// @route   GET /api/instructors/courses/:courseId/progress/export
// @access  Private/Instructor
exports.exportCourseProgressCsv = async (req, res, next) => {
  try {
    const { courseId } = req.params;
    const { status, search, batch } = req.query;

    const course = await Course.findById(courseId);
    if (!course) {
      return res.status(404).json({
        success: false,
        error: 'Course not found',
      });
    }

    const access = await ensureCourseAccess({ course, req });
    if (!access.ok) {
      return res.status(access.status).json(access.payload);
    }

    const hydratedProgress = await buildHydratedCourseProgress(course);
    const filtered = filterProgressRows(hydratedProgress, { status, search, batch });

    const escapeCsv = (value) => {
      const str = value == null ? '' : String(value);
      if (/[",\n]/.test(str)) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    const header = ['Name', 'Email', 'Batch', 'Progress %', 'Status', 'Time Spent (min)', 'Last Accessed'];
    const rows = filtered.map((row) => [
      row.userId?.name || '',
      row.userId?.email || '',
      row.userId?.batch || '',
      Math.round(row.overallCoursePercentage || 0),
      row.completed ? 'Completed' : ((row.overallCoursePercentage || 0) > 0 || row.lastAccessed) ? 'In Progress' : 'Not Started',
      Math.round((row.totalTimeSpent || 0) / 60),
      row.lastAccessed ? new Date(row.lastAccessed).toISOString() : '',
    ]);

    const csv = [header, ...rows].map((line) => line.map(escapeCsv).join(',')).join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="course-${courseId}-progress.csv"`);
    return res.status(200).send(csv);
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
    if (!course) {
      return res.status(403).json({
        success: false,
        error: 'Not authorized',
      });
    }

    const access = await ensureCourseAccess({ course, req });
    if (!access.ok) {
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
          questions: sanitizeAssessmentQuestions(assessment.questions),
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

    if (!course) {
      return res.status(403).json({
        success: false,
        error: 'Not authorized',
      });
    }

    const access = await ensureCourseAccess({ course, req, requireEditor: true });
    if (!access.ok) {
      return res.status(403).json({
        success: false,
        error: access.payload.error,
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


