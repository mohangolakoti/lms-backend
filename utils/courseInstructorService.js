const CourseInstructor = require('../models/CourseInstructor');

const VALID_ROLES = new Set(['viewer', 'editor']);

const normalizeAssignments = (courseInstructors = [], fallbackInstructorId = null) => {
  const source = Array.isArray(courseInstructors) ? courseInstructors : [];
  const normalized = new Map();

  source.forEach((entry) => {
    const instructorId = entry?.instructorId || entry?.instructor_id || entry;
    const role = entry?.role || 'viewer';

    if (!instructorId) return;

    normalized.set(instructorId.toString(), {
      instructorId: instructorId.toString(),
      role: VALID_ROLES.has(role) ? role : 'viewer',
    });
  });

  if (normalized.size === 0 && fallbackInstructorId) {
    normalized.set(fallbackInstructorId.toString(), {
      instructorId: fallbackInstructorId.toString(),
      role: 'editor',
    });
  }

  return Array.from(normalized.values());
};

const buildPrimaryInstructorId = (assignments = [], fallbackInstructorId = null) => {
  if (!assignments.length) return fallbackInstructorId;
  const editorAssignment = assignments.find((item) => item.role === 'editor');
  return (editorAssignment || assignments[0]).instructorId;
};

const syncCourseInstructors = async (courseId, assignments = []) => {
  await CourseInstructor.deleteMany({ course_id: courseId });

  if (!assignments.length) return;

  await CourseInstructor.insertMany(assignments.map((entry) => ({
    course_id: courseId,
    instructor_id: entry.instructorId,
    role: entry.role,
  })));
};

const getCourseRoleForUser = async ({ courseId, userId, fallbackInstructorId, userRole }) => {
  if (userRole === 'admin') return 'editor';

  const assignment = await CourseInstructor.findOne({
    course_id: courseId,
    instructor_id: userId,
  }).lean();

  if (assignment) return assignment.role;

  if (fallbackInstructorId && fallbackInstructorId.toString() === userId.toString()) {
    return 'editor';
  }

  return null;
};

const getCourseAssignmentsMap = async (courseIds = []) => {
  if (!courseIds.length) return new Map();

  const assignments = await CourseInstructor.find({
    course_id: { $in: courseIds },
  }).populate('instructor_id', 'name email');

  const map = new Map();

  assignments.forEach((assignment) => {
    const key = assignment.course_id.toString();
    if (!map.has(key)) {
      map.set(key, []);
    }

    map.get(key).push({
      id: assignment._id,
      instructorId: assignment.instructor_id,
      role: assignment.role,
      createdAt: assignment.created_at,
    });
  });

  return map;
};

module.exports = {
  normalizeAssignments,
  buildPrimaryInstructorId,
  syncCourseInstructors,
  getCourseRoleForUser,
  getCourseAssignmentsMap,
};
