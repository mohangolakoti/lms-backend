process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-access-secret';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';
process.env.JWT_EXPIRE = '1h';
process.env.JWT_REFRESH_EXPIRE = '7d';
process.env.FRONTEND_URL = 'http://localhost:3001';

const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const path = require('path');
const fs = require('fs/promises');

const app = require('../app');
const User = require('../models/User');
const Batch = require('../models/Batch');
const Course = require('../models/Course');
const Assessment = require('../models/Assessment');
const Certificate = require('../models/Certificate');
const CertificateTemplate = require('../models/CertificateTemplate');
const Progress = require('../models/Progress');

describe('student features perfection integrations', () => {
  let mongoServer;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri(), { dbName: 'lms-student-features-test' });
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

  const loginStudent = async (email) => {
    const response = await request(app)
      .post('/api/auth/login')
      .send({ email, password: 'Password123!' });
    return response.body.data.token;
  };

  test('assessment list is batch-scoped and draft course detail is forbidden', async () => {
    const batchA = await Batch.create({ name: 'student-batch-a' });
    const batchB = await Batch.create({ name: 'student-batch-b' });

    const studentA = await User.create({
      name: 'Student A',
      email: 'student-a@example.com',
      password: 'Password123!',
      role: 'student',
      batch: 'longTerm',
      batchId: batchA._id,
      status: 'active',
      approvalStatus: 'approved',
    });

    const courseA = await Course.create({
      title: 'Course A',
      description: 'Batch A course',
      term: 'longTerm',
      level: 'Beginner',
      visibility: 'published',
      instructorId: studentA._id,
      batches: [batchA._id],
      modules: [{ title: 'Module 1', order: 1, lessons: [] }],
    });

    const courseB = await Course.create({
      title: 'Course B',
      description: 'Batch B course',
      term: 'longTerm',
      level: 'Beginner',
      visibility: 'published',
      instructorId: studentA._id,
      batches: [batchB._id],
      modules: [{ title: 'Module B', order: 1, lessons: [] }],
    });

    const draftCourse = await Course.create({
      title: 'Draft Course',
      description: 'Draft',
      term: 'longTerm',
      level: 'Beginner',
      visibility: 'draft',
      instructorId: studentA._id,
      batches: [batchA._id],
      modules: [{ title: 'Draft Module', order: 1, lessons: [] }],
    });

    await Assessment.create({
      courseId: courseA._id,
      title: 'Quiz A',
      description: 'A',
      duration: 30,
      totalMarks: 10,
      passingMarks: 5,
      visibility: 'published',
      createdBy: studentA._id,
      questions: [{ question: 'Q1', type: 'mcq', options: ['A', 'B'], correctAnswer: 'A', marks: 10, order: 1 }],
    });

    await Assessment.create({
      courseId: courseB._id,
      title: 'Quiz B',
      description: 'B',
      duration: 30,
      totalMarks: 10,
      passingMarks: 5,
      visibility: 'published',
      createdBy: studentA._id,
      questions: [{ question: 'Q2', type: 'mcq', options: ['A', 'B'], correctAnswer: 'A', marks: 10, order: 1 }],
    });

    const token = await loginStudent('student-a@example.com');

    const listResponse = await request(app)
      .get('/api/students/assessments')
      .set('Authorization', `Bearer ${token}`);

    expect(listResponse.status).toBe(200);
    expect(listResponse.body.data.some((row) => row.title === 'Quiz A')).toBe(true);
    expect(listResponse.body.data.some((row) => row.title === 'Quiz B')).toBe(false);

    const draftResponse = await request(app)
      .get(`/api/students/courses/${draftCourse._id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(draftResponse.status).toBe(403);
  });

  test('progress update on foreign course is forbidden', async () => {
    const batchA = await Batch.create({ name: 'progress-batch-a' });
    const batchB = await Batch.create({ name: 'progress-batch-b' });

    const studentA = await User.create({
      name: 'Progress Student A',
      email: 'progress-a@example.com',
      password: 'Password123!',
      role: 'student',
      batch: 'longTerm',
      batchId: batchA._id,
      status: 'active',
      approvalStatus: 'approved',
    });

    const courseB = await Course.create({
      title: 'Foreign Course',
      description: 'Other batch',
      term: 'longTerm',
      level: 'Beginner',
      visibility: 'published',
      instructorId: studentA._id,
      batches: [batchB._id],
      modules: [{
        title: 'Module',
        order: 1,
        lessons: [{ title: 'Lesson 1', type: 'pdf', url: 'https://example.com/a.pdf', order: 1 }],
      }],
    });

    const lessonId = courseB.modules[0].lessons[0]._id;
    const token = await loginStudent('progress-a@example.com');

    const response = await request(app)
      .put(`/api/students/courses/${courseB._id}/lessons/${lessonId}/progress`)
      .set('Authorization', `Bearer ${token}`)
      .send({ completed: true });

    expect(response.status).toBe(403);
  });

  test('assessment window enforcement blocks early start and late submit', async () => {
    const batch = await Batch.create({ name: 'window-batch' });
    const student = await User.create({
      name: 'Window Student',
      email: 'window-student@example.com',
      password: 'Password123!',
      role: 'student',
      batch: 'longTerm',
      batchId: batch._id,
      status: 'active',
      approvalStatus: 'approved',
    });

    const course = await Course.create({
      title: 'Window Course',
      description: 'Course',
      term: 'longTerm',
      level: 'Beginner',
      visibility: 'published',
      instructorId: student._id,
      batches: [batch._id],
      modules: [{ title: 'Module', order: 1, lessons: [] }],
    });

    const futureAssessment = await Assessment.create({
      courseId: course._id,
      title: 'Future Quiz',
      duration: 10,
      totalMarks: 10,
      passingMarks: 5,
      visibility: 'published',
      startDate: new Date(Date.now() + 86400000),
      endDate: new Date(Date.now() + 172800000),
      createdBy: student._id,
      questions: [{ question: 'Q', type: 'mcq', options: ['A', 'B'], correctAnswer: 'A', marks: 10, order: 1 }],
    });

    const closedAssessment = await Assessment.create({
      courseId: course._id,
      title: 'Closed Quiz',
      duration: 10,
      totalMarks: 10,
      passingMarks: 5,
      visibility: 'published',
      startDate: new Date(Date.now() - 172800000),
      endDate: new Date(Date.now() - 86400000),
      createdBy: student._id,
      questions: [{ question: 'Q2', type: 'mcq', options: ['A', 'B'], correctAnswer: 'A', marks: 10, order: 1 }],
    });

    const token = await loginStudent('window-student@example.com');

    const futureDetail = await request(app)
      .get(`/api/students/assessments/${futureAssessment._id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(futureDetail.status).toBe(403);

    const closedSubmit = await request(app)
      .post(`/api/students/assessments/${closedAssessment._id}/submit`)
      .set('Authorization', `Bearer ${token}`)
      .send({ answers: [{ questionId: 0, answer: 'A' }], timeTaken: 60 });
    expect(closedSubmit.status).toBe(403);
  });

  test('revoked certificate is hidden from list and blocked on download', async () => {
    const batch = await Batch.create({ name: 'cert-batch' });
    const student = await User.create({
      name: 'Cert Student',
      email: 'cert-student@example.com',
      password: 'Password123!',
      role: 'student',
      batch: 'longTerm',
      batchId: batch._id,
      status: 'active',
      approvalStatus: 'approved',
    });

    const uploadRoot = path.join(__dirname, '..', 'uploads', 'certificates-test');
    await fs.mkdir(uploadRoot, { recursive: true });
    const fileName = 'test-cert.pdf';
    const filePath = path.join('certificates-test', fileName);
    await fs.writeFile(path.join(uploadRoot, fileName), '%PDF-1.4 test');

    const template = await CertificateTemplate.create({
      name: 'Default Template',
      backgroundImage: '/uploads/template-bg.png',
      htmlTemplate: '<html><body>{{studentName}}</body></html>',
    });

    await Certificate.create({
      studentId: student._id,
      batchId: batch._id,
      certificateName: 'Completion',
      duration: '3 months',
      completionDate: new Date(),
      templateId: template._id,
      certificateNumber: 'CERT-ACTIVE-001',
      certificateUrl: '/files/cert-active.pdf',
      filePath,
      isRevoked: false,
    });

    await Certificate.create({
      studentId: student._id,
      batchId: batch._id,
      certificateName: 'Revoked Completion',
      duration: '3 months',
      completionDate: new Date(),
      templateId: template._id,
      certificateNumber: 'CERT-REVOKED-001',
      certificateUrl: '/files/cert-revoked.pdf',
      filePath,
      isRevoked: true,
      revocationReason: 'Invalid data',
    });

    const token = await loginStudent('cert-student@example.com');

    const listResponse = await request(app)
      .get('/api/certificates/my')
      .set('Authorization', `Bearer ${token}`);

    expect(listResponse.status).toBe(200);
    expect(listResponse.body.data).toHaveLength(1);
    expect(listResponse.body.data[0].certificateNumber).toBe('CERT-ACTIVE-001');

    const downloadResponse = await request(app)
      .get('/api/certificates/download/CERT-REVOKED-001')
      .set('Authorization', `Bearer ${token}`);

    expect(downloadResponse.status).toBe(403);
  });

  test('dashboard returns totalTimeSpentSeconds in seconds', async () => {
    const batch = await Batch.create({ name: 'time-batch' });
    const student = await User.create({
      name: 'Time Student',
      email: 'time-student@example.com',
      password: 'Password123!',
      role: 'student',
      batch: 'longTerm',
      batchId: batch._id,
      status: 'active',
      approvalStatus: 'approved',
    });

    const course = await Course.create({
      title: 'Time Course',
      description: 'Course',
      term: 'longTerm',
      level: 'Beginner',
      visibility: 'published',
      instructorId: student._id,
      batches: [batch._id],
      modules: [{ title: 'Module', order: 1, lessons: [] }],
    });

    await Progress.create({
      userId: student._id,
      courseId: course._id,
      moduleProgress: [],
      lessonProgress: [],
      totalTimeSpent: 3661,
    });

    const token = await loginStudent('time-student@example.com');
    const response = await request(app)
      .get('/api/students/dashboard')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.data.metrics.totalTimeSpentSeconds).toBe(3661);
  });

  test('getCourseDetails returns modules with lesson progress without server error', async () => {
    const batch = await Batch.create({ name: 'course-detail-batch' });
    const student = await User.create({
      name: 'Course Detail Student',
      email: 'course-detail-student@example.com',
      password: 'Password123!',
      role: 'student',
      batch: 'longTerm',
      batchId: batch._id,
      status: 'active',
      approvalStatus: 'approved',
    });

    const course = await Course.create({
      title: 'Detail Course',
      description: 'Course detail test',
      term: 'longTerm',
      level: 'Beginner',
      visibility: 'published',
      instructorId: student._id,
      batches: [batch._id],
      modules: [{
        title: 'Module 1',
        order: 1,
        lessons: [
          { title: 'Lesson 1', type: 'pdf', url: 'https://example.com/1.pdf', order: 1 },
          { title: 'Lesson 2', type: 'video', url: 'https://example.com/2.mp4', order: 2 },
        ],
      }],
    });

    const token = await loginStudent('course-detail-student@example.com');
    const response = await request(app)
      .get(`/api/students/courses/${course._id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.data.course.modules).toHaveLength(1);
    expect(response.body.data.course.modules[0].lessons).toHaveLength(2);
    expect(response.body.data.progress.overallCoursePercentage).toBe(0);
  });

  test('getMyCertificates returns legacy certificates without isRevoked field', async () => {
    const batch = await Batch.create({ name: 'legacy-cert-batch' });
    const student = await User.create({
      name: 'Legacy Cert Student',
      email: 'legacy-cert-student@example.com',
      password: 'Password123!',
      role: 'student',
      batch: 'longTerm',
      batchId: batch._id,
      status: 'active',
      approvalStatus: 'approved',
    });

    const template = await CertificateTemplate.create({
      name: 'Legacy Template',
      backgroundImage: '/uploads/template-bg.png',
      htmlTemplate: '<html><body>{{studentName}}</body></html>',
    });

    await Certificate.collection.insertOne({
      studentId: student._id,
      batchId: batch._id,
      certificateName: 'Legacy Certificate',
      duration: '3 months',
      completionDate: new Date(),
      templateId: template._id,
      certificateNumber: 'CERT-LEGACY-001',
      certificateUrl: '/files/cert-legacy.pdf',
      filePath: 'certificates-test/legacy.pdf',
      issuedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const token = await loginStudent('legacy-cert-student@example.com');
    const response = await request(app)
      .get('/api/certificates/my')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.some((row) => row.certificateNumber === 'CERT-LEGACY-001')).toBe(true);
  });

  test('learning-path endpoint returns continue lesson payload', async () => {
    const batch = await Batch.create({ name: 'path-batch' });
    const student = await User.create({
      name: 'Path Student',
      email: 'path-student@example.com',
      password: 'Password123!',
      role: 'student',
      batch: 'longTerm',
      batchId: batch._id,
      status: 'active',
      approvalStatus: 'approved',
    });

    const course = await Course.create({
      title: 'Path Course',
      description: 'Course',
      term: 'longTerm',
      level: 'Beginner',
      visibility: 'published',
      instructorId: student._id,
      batches: [batch._id],
      modules: [{
        title: 'Module 1',
        order: 1,
        lessons: [
          { title: 'Lesson 1', type: 'pdf', url: 'https://example.com/1.pdf', order: 1 },
          { title: 'Lesson 2', type: 'pdf', url: 'https://example.com/2.pdf', order: 2 },
        ],
      }],
    });

    const lesson1Id = course.modules[0].lessons[0]._id;
    await Progress.create({
      userId: student._id,
      courseId: course._id,
      moduleProgress: [{ moduleId: course.modules[0]._id, completedLessons: [lesson1Id], completionPercentage: 50 }],
      lessonProgress: [{ lessonId: lesson1Id, completed: true, lastWatchedSecond: 10 }],
      overallCoursePercentage: 50,
    });

    const token = await loginStudent('path-student@example.com');
    const response = await request(app)
      .get('/api/students/learning-path')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.data.continueLesson.lessonTitle).toBe('Lesson 2');
  });
});
