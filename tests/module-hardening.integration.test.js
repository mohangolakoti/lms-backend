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

describe('module hardening integrations', () => {
  let mongoServer;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri(), { dbName: 'lms-hardening-test' });
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

  test('admin students endpoint returns paginated payload', async () => {
    await User.create({
      name: 'Admin',
      email: 'admin-pagination@example.com',
      password: 'password123',
      role: 'admin',
      status: 'active',
    });

    const batch = await Batch.create({ name: 'pagination-batch' });
    const studentDocs = Array.from({ length: 22 }, (_, index) => ({
      name: `Student ${index + 1}`,
      email: `student${index + 1}@example.com`,
      password: 'password123',
      role: 'student',
      batch: 'longTerm',
      batchId: batch._id,
      status: 'active',
      approvalStatus: 'approved',
    }));
    await User.insertMany(studentDocs);

    const adminLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin-pagination@example.com', password: 'password123' });

    const response = await request(app)
      .get('/api/admin/students?page=2&limit=10&approvalStatus=approved')
      .set('Authorization', `Bearer ${adminLogin.body.data.token}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(Array.isArray(response.body.data)).toBe(true);
    expect(response.body.data.length).toBe(10);
    expect(response.body.pagination).toEqual(expect.objectContaining({
      page: 2,
      limit: 10,
      total: 22,
      pages: 3,
      hasNextPage: true,
      hasPrevPage: true,
    }));
  });

  test('instructor assessment analytics reports totals and trend', async () => {
    const batch = await Batch.create({ name: 'analytics-batch' });
    const instructor = await User.create({
      name: 'Instructor',
      email: 'instructor-analytics@example.com',
      password: 'password123',
      role: 'instructor',
      status: 'active',
    });

    const studentA = await User.create({
      name: 'Student A',
      email: 'analytics-a@example.com',
      password: 'password123',
      role: 'student',
      batch: 'longTerm',
      batchId: batch._id,
      status: 'active',
      approvalStatus: 'approved',
    });
    const studentB = await User.create({
      name: 'Student B',
      email: 'analytics-b@example.com',
      password: 'password123',
      role: 'student',
      batch: 'longTerm',
      batchId: batch._id,
      status: 'active',
      approvalStatus: 'approved',
    });

    const course = await Course.create({
      title: 'Analytics Course',
      description: 'Course for analytics tests',
      term: 'longTerm',
      level: 'Beginner',
      visibility: 'published',
      instructorId: instructor._id,
      batches: [batch._id],
      modules: [],
    });

    const assessment = await Assessment.create({
      courseId: course._id,
      title: 'Weekly Quiz',
      description: 'Analytics quiz',
      duration: 30,
      totalMarks: 100,
      passingMarks: 50,
      visibility: 'published',
      createdBy: instructor._id,
      questions: [{
        question: 'Q1',
        type: 'mcq',
        options: ['A', 'B'],
        correctAnswer: 'A',
        marks: 100,
        order: 1,
      }],
    });

    await Submission.create({
      userId: studentA._id,
      assessmentId: assessment._id,
      answers: [{ questionId: 0, answer: 'A', isCorrect: true, marksObtained: 80 }],
      score: 80,
      totalMarks: 100,
      percentage: 80,
      passed: true,
      timeTaken: 20,
      submittedAt: new Date('2026-05-20T10:00:00.000Z'),
    });

    await Submission.create({
      userId: studentB._id,
      assessmentId: assessment._id,
      answers: [{ questionId: 0, answer: 'B', isCorrect: false, marksObtained: 30 }],
      score: 30,
      totalMarks: 100,
      percentage: 30,
      passed: false,
      timeTaken: 25,
      submittedAt: new Date('2026-05-21T10:00:00.000Z'),
    });

    const instructorLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: 'instructor-analytics@example.com', password: 'password123' });

    const response = await request(app)
      .get(`/api/instructors/assessments/${assessment._id}/analytics`)
      .set('Authorization', `Bearer ${instructorLogin.body.data.token}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.totals).toEqual(expect.objectContaining({
      totalAttempts: 2,
      passCount: 1,
      failCount: 1,
    }));
    expect(response.body.data.totals.passRate).toBeCloseTo(50, 1);
    expect(response.body.data.trend).toHaveLength(2);
    expect(response.body.data.totals.averageTimeTakenSeconds).toBeCloseTo(22.5, 1);
    expect(response.body.data.totals.averageTimeTakenMinutes).toBeCloseTo(0.375, 3);
  });

  test('instructor reorder routes apply ordering instead of dynamic route collision', async () => {
    const batch = await Batch.create({ name: 'reorder-batch' });
    const instructor = await User.create({
      name: 'Instructor Reorder',
      email: 'instructor-reorder@example.com',
      password: 'password123',
      role: 'instructor',
      status: 'active',
    });

    const course = await Course.create({
      title: 'Reorder Course',
      description: 'Reorder course',
      term: 'longTerm',
      level: 'Beginner',
      visibility: 'published',
      instructorId: instructor._id,
      batches: [batch._id],
      modules: [
        {
          title: 'Module 1',
          order: 1,
          lessons: [
            { title: 'Lesson 1', type: 'video', url: 'https://example.com/1', order: 1 },
            { title: 'Lesson 2', type: 'video', url: 'https://example.com/2', order: 2 },
          ],
        },
        {
          title: 'Module 2',
          order: 2,
          lessons: [],
        },
      ],
    });

    const instructorLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: 'instructor-reorder@example.com', password: 'password123' });
    const token = instructorLogin.body.data.token;

    const moduleIds = course.modules.map((module) => module._id.toString()).reverse();
    const reorderModulesResponse = await request(app)
      .put(`/api/instructors/courses/${course._id}/modules/reorder`)
      .set('Authorization', `Bearer ${token}`)
      .send({ moduleOrder: moduleIds });

    expect(reorderModulesResponse.status).toBe(200);
    expect(reorderModulesResponse.body.success).toBe(true);

    const lessonIds = course.modules[0].lessons.map((lesson) => lesson._id.toString()).reverse();
    const reorderLessonsResponse = await request(app)
      .put(`/api/instructors/courses/${course._id}/modules/${course.modules[0]._id}/lessons/reorder`)
      .set('Authorization', `Bearer ${token}`)
      .send({ lessonOrder: lessonIds });

    expect(reorderLessonsResponse.status).toBe(200);
    expect(reorderLessonsResponse.body.success).toBe(true);
  });

  test('instructor submissions payload omits assessment correct answers and supports visibility updates', async () => {
    const batch = await Batch.create({ name: 'assessment-batch' });
    const instructor = await User.create({
      name: 'Instructor Visibility',
      email: 'instructor-visibility@example.com',
      password: 'password123',
      role: 'instructor',
      status: 'active',
    });

    const student = await User.create({
      name: 'Student Visibility',
      email: 'student-visibility@example.com',
      password: 'password123',
      role: 'student',
      batch: 'longTerm',
      batchId: batch._id,
      status: 'active',
      approvalStatus: 'approved',
    });

    const course = await Course.create({
      title: 'Visibility Course',
      description: 'Course for visibility tests',
      term: 'longTerm',
      level: 'Beginner',
      visibility: 'published',
      instructorId: instructor._id,
      batches: [batch._id],
      modules: [{
        title: 'Module A',
        order: 1,
        lessons: [],
      }],
    });

    const assessment = await Assessment.create({
      courseId: course._id,
      moduleId: course.modules[0]._id,
      title: 'Secure Quiz',
      description: 'Secure quiz',
      duration: 30,
      totalMarks: 100,
      passingMarks: 50,
      visibility: 'draft',
      createdBy: instructor._id,
      questions: [{
        question: 'Secret Q',
        type: 'mcq',
        options: ['A', 'B'],
        correctAnswer: 'A',
        marks: 100,
        order: 1,
      }],
    });

    await Submission.create({
      userId: student._id,
      assessmentId: assessment._id,
      answers: [{ questionId: 0, answer: 'B', isCorrect: false, marksObtained: 0 }],
      score: 0,
      totalMarks: 100,
      percentage: 0,
      passed: false,
      timeTaken: 90,
    });

    const instructorLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: 'instructor-visibility@example.com', password: 'password123' });
    const token = instructorLogin.body.data.token;

    const updateVisibilityResponse = await request(app)
      .put(`/api/instructors/assessments/${assessment._id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ visibility: 'published' });

    expect(updateVisibilityResponse.status).toBe(200);
    expect(updateVisibilityResponse.body.data.visibility).toBe('published');

    const submissionsResponse = await request(app)
      .get(`/api/instructors/assessments/${assessment._id}/submissions`)
      .set('Authorization', `Bearer ${token}`);

    expect(submissionsResponse.status).toBe(200);
    const returnedQuestion = submissionsResponse.body.data.assessment.questions[0];
    expect(returnedQuestion.correctAnswer).toBeUndefined();
  });
});
