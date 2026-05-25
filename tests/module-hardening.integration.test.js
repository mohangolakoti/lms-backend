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
  });
});
