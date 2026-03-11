require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../config/database');
const Course = require('../models/Course');
const CourseInstructor = require('../models/CourseInstructor');

const migrateCourseInstructors = async () => {
  await connectDB();

  const courses = await Course.find({
    instructorId: { $exists: true, $ne: null },
  })
    .select('_id instructorId title')
    .lean();

  if (!courses.length) {
    console.log('No courses found. Nothing to migrate.');
    return;
  }

  const courseIds = courses.map((course) => course._id);
  const existingAssignments = await CourseInstructor.find({
    course_id: { $in: courseIds },
  })
    .select('course_id')
    .lean();

  const assignedCourseIdSet = new Set(
    existingAssignments.map((item) => item.course_id.toString()),
  );

  const docsToInsert = [];

  for (const course of courses) {
    if (assignedCourseIdSet.has(course._id.toString())) {
      continue;
    }

    docsToInsert.push({
      course_id: course._id,
      instructor_id: course.instructorId,
      role: 'editor',
    });
  }

  if (docsToInsert.length > 0) {
    await CourseInstructor.insertMany(docsToInsert, { ordered: false });
  }

  console.log('Course instructor migration complete.');
  console.log(`Total courses scanned: ${courses.length}`);
  console.log(`Courses backfilled: ${docsToInsert.length}`);
  console.log(`Courses already assigned: ${courses.length - docsToInsert.length}`);
};

const run = async () => {
  try {
    await migrateCourseInstructors();
    process.exit(0);
  } catch (error) {
    console.error('Migration failed:', error.message);
    process.exit(1);
  } finally {
    await mongoose.connection.close();
  }
};

if (require.main === module) {
  run();
}

module.exports = migrateCourseInstructors;
