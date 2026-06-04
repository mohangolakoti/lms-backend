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
const CertificateJob = require('../models/CertificateJob');

describe('admin hardening integration flows', () => {
  let mongoServer;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri(), { dbName: 'lms-admin-hardening-test' });
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

  const createAdminAndToken = async () => {
    await User.create({
      name: 'Admin User',
      email: 'admin-hardening@example.com',
      password: 'password123',
      role: 'admin',
      status: 'active',
    });

    const adminLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin-hardening@example.com', password: 'password123' });

    return adminLogin.body.data.token;
  };

  test('student reject and re-approve persist approval history reasons', async () => {
    const token = await createAdminAndToken();
    const batch = await Batch.create({ name: 'approval-history-batch' });
    const student = await User.create({
      name: 'Student Lifecycle',
      email: 'student-lifecycle@example.com',
      password: 'password123',
      role: 'student',
      status: 'active',
      batch: 'longTerm',
      batchId: batch._id,
      approvalStatus: 'pending',
    });

    const rejectResponse = await request(app)
      .put(`/api/admin/students/${student._id}/reject`)
      .set('Authorization', `Bearer ${token}`)
      .send({ reason: 'Missing profile verification' });
    expect(rejectResponse.status).toBe(200);

    const approveResponse = await request(app)
      .put(`/api/admin/students/${student._id}/approve`)
      .set('Authorization', `Bearer ${token}`)
      .send({ reason: 'Docs validated' });
    expect(approveResponse.status).toBe(200);

    const detailResponse = await request(app)
      .get(`/api/admin/students/${student._id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(detailResponse.status).toBe(200);
    const history = detailResponse.body.data.student.approvalHistory || [];
    expect(history.length).toBe(2);
    expect(history[0]).toEqual(expect.objectContaining({
      status: 'rejected',
      reason: 'Missing profile verification',
    }));
    expect(history[1]).toEqual(expect.objectContaining({
      status: 'approved',
      reason: 'Docs validated',
    }));
  });

  test('batch delete is blocked when dependencies exist', async () => {
    const token = await createAdminAndToken();
    const batch = await Batch.create({ name: 'batch-delete-guard', isActive: false });
    await User.create({
      name: 'Dependent Student',
      email: 'dependent-student@example.com',
      password: 'password123',
      role: 'student',
      status: 'active',
      batch: 'shortTerm',
      batchId: batch._id,
      approvalStatus: 'approved',
    });

    const response = await request(app)
      .delete(`/api/admin/batches/${batch._id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(400);
    expect(response.body.message || response.body.error).toMatch(/Cannot delete batch/i);
  });

  test('admin course list supports pagination and visibility filters', async () => {
    const token = await createAdminAndToken();
    const batch = await Batch.create({ name: 'course-list-batch' });
    const instructor = await User.create({
      name: 'Course Instructor',
      email: 'course-instructor@example.com',
      password: 'password123',
      role: 'instructor',
      status: 'active',
    });

    await Course.create({
      title: 'Draft Course A',
      description: 'Draft one',
      term: 'both',
      level: 'Beginner',
      visibility: 'draft',
      instructorId: instructor._id,
      batches: [batch._id],
      modules: [],
    });
    await Course.create({
      title: 'Published Course B',
      description: 'Published one',
      term: 'both',
      level: 'Intermediate',
      visibility: 'published',
      instructorId: instructor._id,
      batches: [batch._id],
      modules: [],
    });
    await Course.create({
      title: 'Draft Course C',
      description: 'Draft two',
      term: 'both',
      level: 'Advanced',
      visibility: 'draft',
      instructorId: instructor._id,
      batches: [batch._id],
      modules: [],
    });

    const response = await request(app)
      .get('/api/admin/courses?visibility=draft&page=1&limit=1')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.pagination).toEqual(expect.objectContaining({
      page: 1,
      limit: 1,
      total: 2,
      pages: 2,
      hasNextPage: true,
      hasPrevPage: false,
    }));
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].visibility).toBe('draft');
  });

  test('certificate jobs list endpoint returns paginated jobs', async () => {
    const token = await createAdminAndToken();
    const admin = await User.findOne({ email: 'admin-hardening@example.com' });

    await CertificateJob.create({
      requestedBy: admin._id,
      payload: { mode: 'batch', batchId: new mongoose.Types.ObjectId().toString() },
      idempotencyKey: 'job-1',
      status: 'queued',
    });
    await CertificateJob.create({
      requestedBy: admin._id,
      payload: { mode: 'individual', studentId: new mongoose.Types.ObjectId().toString() },
      idempotencyKey: 'job-2',
      status: 'completed',
    });

    const response = await request(app)
      .get('/api/certificates/jobs?page=1&limit=1')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.items).toHaveLength(1);
    expect(response.body.data.pagination).toEqual(expect.objectContaining({
      page: 1,
      limit: 1,
      total: 2,
      pages: 2,
      hasNextPage: true,
      hasPrevPage: false,
    }));
  });
});
