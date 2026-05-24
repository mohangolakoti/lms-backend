process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-access-secret';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';
process.env.JWT_EXPIRE = '1h';
process.env.JWT_REFRESH_EXPIRE = '7d';
process.env.FRONTEND_URL = 'http://localhost:3001';

const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

jest.mock('../utils/sendEmail', () => jest.fn().mockResolvedValue(true));

const app = require('../app');
const User = require('../models/User');
const Batch = require('../models/Batch');
const RefreshSession = require('../models/RefreshSession');

describe('Phase B auth and approval integrations', () => {
  let mongoServer;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri(), { dbName: 'lms-test' });
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

  test('rejects public admin registration', async () => {
    await Batch.create({ name: 'phase-b-batch' });

    const response = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'Malicious Admin',
        email: 'bad-admin@example.com',
        password: 'password123',
        role: 'admin',
        batch: 'longTerm',
      });

    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
    expect(response.body.message).toContain('Public registration is only available for students');
  });

  test('forgot password does not leak resetToken in response payload', async () => {
    await User.create({
      name: 'Test Student',
      email: 'student@example.com',
      password: 'password123',
      role: 'student',
      batch: 'longTerm',
      approvalStatus: 'approved',
      batchId: new mongoose.Types.ObjectId(),
    });

    const response = await request(app)
      .post('/api/auth/forgotpassword')
      .send({ email: 'student@example.com' });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toBeUndefined();
    expect(response.body.message).toBe('Email sent');
  });

  test('refresh endpoint returns new tokens for approved student', async () => {
    const batch = await Batch.create({ name: 'refresh-batch' });

    await User.create({
      name: 'Approved Student',
      email: 'approved@student.com',
      password: 'password123',
      role: 'student',
      batch: 'longTerm',
      approvalStatus: 'approved',
      batchId: batch._id,
      status: 'active',
      batchBlocked: false,
    });

    const loginResponse = await request(app)
      .post('/api/auth/login')
      .send({ email: 'approved@student.com', password: 'password123' });

    expect(loginResponse.status).toBe(200);
    expect(loginResponse.body.data.refreshToken).toBeDefined();

    const refreshResponse = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: loginResponse.body.data.refreshToken });

    expect(refreshResponse.status).toBe(200);
    expect(refreshResponse.body.success).toBe(true);
    expect(refreshResponse.body.data.token).toBeDefined();
    expect(refreshResponse.body.data.refreshToken).toBeDefined();
  });

  test('pending approvals endpoint resolves correctly (route order check)', async () => {
    const batch = await Batch.create({ name: 'pending-batch' });

    await User.create({
      name: 'Admin User',
      email: 'admin@example.com',
      password: 'password123',
      role: 'admin',
      status: 'active',
    });

    await User.create({
      name: 'Pending Student',
      email: 'pending@student.com',
      password: 'password123',
      role: 'student',
      batch: 'longTerm',
      approvalStatus: 'pending',
      batchId: batch._id,
      status: 'active',
    });

    const adminLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@example.com', password: 'password123' });

    const response = await request(app)
      .get('/api/admin/students/approval/pending')
      .set('Authorization', `Bearer ${adminLogin.body.data.token}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(Array.isArray(response.body.data)).toBe(true);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].email).toBe('pending@student.com');
  });

  test('logout revokes refresh token', async () => {
    const batch = await Batch.create({ name: 'logout-batch' });

    await User.create({
      name: 'Token Student',
      email: 'token@student.com',
      password: 'password123',
      role: 'student',
      batch: 'longTerm',
      approvalStatus: 'approved',
      batchId: batch._id,
      status: 'active',
    });

    const loginResponse = await request(app)
      .post('/api/auth/login')
      .send({ email: 'token@student.com', password: 'password123' });

    const accessToken = loginResponse.body.data.token;
    const refreshToken = loginResponse.body.data.refreshToken;

    const logoutResponse = await request(app)
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${accessToken}`)
      .send();

    expect(logoutResponse.status).toBe(200);

    const refreshResponse = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken });

    expect(refreshResponse.status).toBe(401);
    expect(refreshResponse.body.success).toBe(false);
    expect(refreshResponse.body.message).toContain('revoked');
  });

  test('pending student cannot login and admin cannot access student-only route', async () => {
    const batch = await Batch.create({ name: 'rbac-batch' });

    await User.create({
      name: 'Pending Student 2',
      email: 'pending2@student.com',
      password: 'password123',
      role: 'student',
      batch: 'longTerm',
      approvalStatus: 'pending',
      batchId: batch._id,
      status: 'active',
    });

    const pendingLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: 'pending2@student.com', password: 'password123' });

    expect(pendingLogin.status).toBe(403);
    expect(pendingLogin.body.success).toBe(false);

    await User.create({
      name: 'Admin RBAC',
      email: 'rbac-admin@example.com',
      password: 'password123',
      role: 'admin',
      status: 'active',
    });

    const adminLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: 'rbac-admin@example.com', password: 'password123' });

    const adminAgainstStudentRoute = await request(app)
      .get('/api/students/dashboard')
      .set('Authorization', `Bearer ${adminLogin.body.data.token}`);

    expect(adminAgainstStudentRoute.status).toBe(403);
    expect(adminAgainstStudentRoute.body.success).toBe(false);
  });

  test('session list and per-session revoke works', async () => {
    const batch = await Batch.create({ name: 'session-list-batch' });

    await User.create({
      name: 'Session Student',
      email: 'session@student.com',
      password: 'password123',
      role: 'student',
      batch: 'longTerm',
      approvalStatus: 'approved',
      batchId: batch._id,
      status: 'active',
    });

    const loginResponse = await request(app)
      .post('/api/auth/login')
      .set('User-Agent', 'Jest Session Client A')
      .send({ email: 'session@student.com', password: 'password123' });

    const accessToken = loginResponse.body.data.token;
    const refreshToken = loginResponse.body.data.refreshToken;

    const sessionsResponse = await request(app)
      .get('/api/auth/sessions')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(sessionsResponse.status).toBe(200);
    expect(Array.isArray(sessionsResponse.body.data)).toBe(true);
    expect(sessionsResponse.body.data.length).toBeGreaterThan(0);

    const sessionId = sessionsResponse.body.data[0].sessionId;
    expect(sessionId).toBeDefined();

    const revokeResponse = await request(app)
      .delete(`/api/auth/sessions/${sessionId}`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(revokeResponse.status).toBe(200);

    const revokedSession = await RefreshSession.findOne({ sessionId });
    expect(revokedSession).toBeTruthy();
    expect(revokedSession.isRevoked).toBe(true);

    const refreshAfterRevoke = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken });

    expect(refreshAfterRevoke.status).toBe(401);
    expect(refreshAfterRevoke.body.success).toBe(false);
  });
});
