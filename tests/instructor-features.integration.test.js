process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-access-secret';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';
process.env.JWT_EXPIRE = '1h';
process.env.JWT_REFRESH_EXPIRE = '7d';
process.env.FRONTEND_URL = 'http://localhost:3001';

const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const app = require('../app');
const User = require('../models/User');
const Batch = require('../models/Batch');
const Course = require('../models/Course');
const Assessment = require('../models/Assessment');
const Submission = require('../models/Submission');
const CourseInstructor = require('../models/CourseInstructor');

describe('instructor features perfection integrations', () => {
  let mongoServer;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri(), { dbName: 'lms-instructor-features-test' });
  });

  afterEach(async () => {
    await Promise.all(
      Object.values(mongoose.connection.collections).map((collection) => collection.deleteMany({}))
    );
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  const seedCourseWithInstructors = async () => {
    const batch = await Batch.create({ name: 'instructor-features-batch' });
    const editor = await User.create({
      name: 'Editor Instructor',
      email: 'editor-instructor@example.com',
      password: 'Password123!',
      role: 'instructor',
      status: 'active',
    });
    const viewer = await User.create({
      name: 'Viewer Instructor',
      email: 'viewer-instructor@example.com',
      password: 'Password123!',
      role: 'instructor',
      status: 'active',
    });

    const course = await Course.create({
      title: 'Instructor Features Course',
      description: 'Course for instructor feature tests',
      term: 'longTerm',
      level: 'Beginner',
      visibility: 'published',
      instructorId: editor._id,
      batches: [batch._id],
      modules: [
        {
          title: 'Module A',
          order: 1,
          lessons: [
            { title: 'Lesson 1', type: 'video', url: 'https://example.com/1.mp4', order: 1 },
            { title: 'Lesson 2', type: 'pdf', url: 'https://example.com/doc.pdf', order: 2 },
          ],
        },
      ],
    });

    await CourseInstructor.create([
      { course_id: course._id, instructor_id: editor._id, role: 'editor' },
      { course_id: course._id, instructor_id: viewer._id, role: 'viewer' },
    ]);

    const editorLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: 'editor-instructor@example.com', password: 'Password123!' });
    const viewerLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: 'viewer-instructor@example.com', password: 'Password123!' });

    return {
      batch,
      course,
      editor,
      viewer,
      editorToken: editorLogin.body.data.token,
      viewerToken: viewerLogin.body.data.token,
    };
  };

  test('viewer can GET course by id with viewer role', async () => {
    const { course, viewerToken } = await seedCourseWithInstructors();

    const response = await request(app)
      .get(`/api/instructors/courses/${course._id}`)
      .set('Authorization', `Bearer ${viewerToken}`);

    expect(response.status).toBe(200);
    expect(response.body.data.instructorRole).toBe('viewer');
    expect(response.body.data.title).toBe('Instructor Features Course');
  });

  test('viewer cannot mutate modules but editor can update title without changing order', async () => {
    const { course, editorToken, viewerToken } = await seedCourseWithInstructors();
    const moduleId = course.modules[0]._id;
    const originalOrder = course.modules[0].order;

    const viewerUpdate = await request(app)
      .put(`/api/instructors/courses/${course._id}/modules/${moduleId}`)
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ title: 'Blocked Update' });

    expect(viewerUpdate.status).toBe(403);

    const editorUpdate = await request(app)
      .put(`/api/instructors/courses/${course._id}/modules/${moduleId}`)
      .set('Authorization', `Bearer ${editorToken}`)
      .send({ title: 'Updated Module Title' });

    expect(editorUpdate.status).toBe(200);

    const refreshed = await request(app)
      .get(`/api/instructors/courses/${course._id}`)
      .set('Authorization', `Bearer ${editorToken}`);

    expect(refreshed.body.data.modules[0].title).toBe('Updated Module Title');
    expect(refreshed.body.data.modules[0].order).toBe(originalOrder);
  });

  test('editor reorder persists module order', async () => {
    const { course, editorToken } = await seedCourseWithInstructors();

    const secondModule = course.modules[0];
    const courseWithTwoModules = await Course.findByIdAndUpdate(
      course._id,
      {
        $push: {
          modules: {
            title: 'Module B',
            order: 2,
            lessons: [],
          },
        },
      },
      { new: true }
    );

    const moduleOrder = [
      courseWithTwoModules.modules[1]._id.toString(),
      courseWithTwoModules.modules[0]._id.toString(),
    ];

    const reorderResponse = await request(app)
      .put(`/api/instructors/courses/${course._id}/modules/reorder`)
      .set('Authorization', `Bearer ${editorToken}`)
      .send({ moduleOrder });

    expect(reorderResponse.status).toBe(200);
    expect(reorderResponse.body.data.modules[0].title).toBe('Module B');
  });

  test('assessment delete blocked when submissions exist', async () => {
    const { course, editor, editorToken } = await seedCourseWithInstructors();
    const student = await User.create({
      name: 'Student One',
      email: 'student-one@example.com',
      password: 'Password123!',
      role: 'student',
      batch: 'longTerm',
      batchId: course.batches[0],
      status: 'active',
      approvalStatus: 'approved',
    });

    const assessment = await Assessment.create({
      courseId: course._id,
      title: 'Delete Guard Quiz',
      description: 'Quiz',
      duration: 20,
      totalMarks: 100,
      passingMarks: 50,
      visibility: 'published',
      createdBy: editor._id,
      questions: [{
        question: 'Q1',
        type: 'mcq',
        options: ['A', 'B'],
        correctAnswer: 'A',
        marks: 100,
        order: 0,
      }],
    });

    await Submission.create({
      userId: student._id,
      assessmentId: assessment._id,
      answers: [{ questionId: 0, answer: 'A', isCorrect: true, marksObtained: 100 }],
      score: 100,
      totalMarks: 100,
      percentage: 100,
      passed: true,
      timeTaken: 60,
    });

    const deleteResponse = await request(app)
      .delete(`/api/instructors/assessments/${assessment._id}`)
      .set('Authorization', `Bearer ${editorToken}`);

    expect(deleteResponse.status).toBe(409);
  });

  test('assessment duplicate creates draft copy and progress export returns CSV headers', async () => {
    const { course, editor, editorToken } = await seedCourseWithInstructors();

    const assessment = await Assessment.create({
      courseId: course._id,
      title: 'Duplicate Quiz',
      description: 'Quiz',
      duration: 20,
      totalMarks: 100,
      passingMarks: 50,
      visibility: 'published',
      createdBy: editor._id,
      questions: [{
        question: 'Q1',
        type: 'mcq',
        options: ['A', 'B'],
        correctAnswer: 'A',
        marks: 100,
        order: 0,
      }],
    });

    const duplicateResponse = await request(app)
      .post(`/api/instructors/assessments/${assessment._id}/duplicate`)
      .set('Authorization', `Bearer ${editorToken}`);

    expect(duplicateResponse.status).toBe(201);
    expect(duplicateResponse.body.data.visibility).toBe('draft');
    expect(duplicateResponse.body.data.title).toContain('Copy');

    const exportResponse = await request(app)
      .get(`/api/instructors/courses/${course._id}/progress/export`)
      .set('Authorization', `Bearer ${editorToken}`);

    expect(exportResponse.status).toBe(200);
    expect(exportResponse.headers['content-type']).toContain('text/csv');
    expect(exportResponse.text.split('\n')[0]).toContain('Name');
    expect(exportResponse.text.split('\n')[0]).toContain('Email');
  });

  test('progress endpoint supports status filter', async () => {
    const { course, editorToken, batch } = await seedCourseWithInstructors();
    const student = await User.create({
      name: 'Progress Student',
      email: 'progress-student@example.com',
      password: 'Password123!',
      role: 'student',
      batch: 'longTerm',
      batchId: batch._id,
      status: 'active',
      approvalStatus: 'approved',
    });

    await request(app)
      .get(`/api/instructors/courses/${course._id}/progress?status=not_started`)
      .set('Authorization', `Bearer ${editorToken}`)
      .then((response) => {
        expect(response.status).toBe(200);
        expect(response.body.data.some((row) => row.userId._id === student._id.toString())).toBe(true);
      });
  });
});
