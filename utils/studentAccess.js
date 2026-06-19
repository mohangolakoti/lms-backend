const { ForbiddenError } = require('./errors');

const getBatchId = (user) => {
  if (!user?.batchId) return null;
  return user.batchId._id ? user.batchId._id : user.batchId;
};

const canAccessCourse = (user, course) => {
  if (!user || !course) {
    return { allowed: false, reason: 'Invalid access context' };
  }

  const batchId = getBatchId(user);
  if (!batchId) {
    return { allowed: false, reason: 'No batch assigned. Unable to access courses.' };
  }

  if (course.visibility !== 'published') {
    return { allowed: false, reason: 'Course is not published' };
  }

  const termMatch = course.term === user.batch || course.term === 'both';
  if (!termMatch) {
    return { allowed: false, reason: 'Course not available for your batch term' };
  }

  const batches = course.batches || [];
  const batchInCourse = batches.some((batch) => {
    const id = batch._id ? batch._id.toString() : batch.toString();
    return id === batchId.toString();
  });

  if (!batchInCourse) {
    return { allowed: false, reason: 'You do not have access to this course' };
  }

  return { allowed: true };
};

const assertCourseAccess = (user, course) => {
  const result = canAccessCourse(user, course);
  if (!result.allowed) {
    throw new ForbiddenError(result.reason);
  }
};

const buildAssignedCoursesQuery = (user) => {
  const batchId = getBatchId(user);
  if (!batchId) return null;

  return {
    $and: [
      {
        $or: [
          { term: user.batch },
          { term: 'both' },
        ],
      },
      { batches: batchId },
    ],
    visibility: 'published',
  };
};

const getAssessmentWindowStatus = (assessment, now = new Date()) => {
  if (assessment.startDate && now < new Date(assessment.startDate)) {
    return 'upcoming';
  }
  if (assessment.endDate && now > new Date(assessment.endDate)) {
    return 'closed';
  }
  return 'live';
};

const assertAssessmentWindow = (assessment, options = {}) => {
  const { allowViewSubmitted = false, hasSubmission = false } = options;
  const status = getAssessmentWindowStatus(assessment);

  if (status === 'upcoming') {
    throw new ForbiddenError('This assessment is not available yet');
  }

  if (status === 'closed' && !(allowViewSubmitted && hasSubmission)) {
    throw new ForbiddenError('This assessment window has closed');
  }

  return status;
};

const sortModulesWithLessons = (modules = []) => [...modules]
  .sort((a, b) => a.order - b.order)
  .map((module) => ({
    ...(module.toObject ? module.toObject() : module),
    lessons: [...(module.lessons || [])].sort((a, b) => a.order - b.order),
  }));

const findContinueLesson = (course, progress) => {
  const sortedModules = sortModulesWithLessons(course.modules || []);

  for (const module of sortedModules) {
    for (const lesson of module.lessons || []) {
      const lessonProg = progress?.lessonProgress?.find(
        (lp) => lp.lessonId.toString() === lesson._id.toString()
      );
      if (!lessonProg?.completed) {
        return {
          courseId: course._id,
          courseTitle: course.title,
          moduleId: module._id,
          moduleTitle: module.title,
          lessonId: lesson._id,
          lessonTitle: lesson.title,
        };
      }
    }
  }

  return null;
};

module.exports = {
  getBatchId,
  canAccessCourse,
  assertCourseAccess,
  buildAssignedCoursesQuery,
  getAssessmentWindowStatus,
  assertAssessmentWindow,
  sortModulesWithLessons,
  findContinueLesson,
};
