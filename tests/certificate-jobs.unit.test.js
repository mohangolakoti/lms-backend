process.env.NODE_ENV = 'test';

jest.mock('../models/CertificateJob', () => ({
  findOne: jest.fn(),
  findById: jest.fn(),
}));

jest.mock('../utils/certificateQueue', () => ({
  setProcessor: jest.fn(),
  enqueue: jest.fn(),
}));

const CertificateJob = require('../models/CertificateJob');
const { enqueue } = require('../utils/certificateQueue');
const certificateController = require('../controllers/certificateController');

const createMockRes = () => {
  const res = {};
  res.headersSent = false;
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

describe('certificate job controller flow', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  test('returns idempotent job when matching active job exists', async () => {
    CertificateJob.findOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        _id: 'job-existing',
        status: 'processing',
        result: null,
      }),
    });

    const req = {
      user: { id: 'admin-1' },
      body: {
        mode: 'batch',
        batchId: 'batch-1',
        templateId: 'template-1',
        certificateName: 'Node Course',
        durationText: '12 weeks',
        completionDate: '2026-05-25',
      },
    };
    const res = createMockRes();
    const next = jest.fn();

    await certificateController.generateCertificates(req, res, next);

    expect(enqueue).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      data: expect.objectContaining({
        jobId: 'job-existing',
        status: 'processing',
        idempotent: true,
      }),
    }));
    expect(next).not.toHaveBeenCalled();
  });

  test('queues new job when no active idempotent match exists', async () => {
    CertificateJob.findOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue(null),
    });
    enqueue.mockResolvedValue({
      _id: 'job-new',
      status: 'queued',
    });

    const req = {
      user: { id: 'admin-1' },
      body: {
        mode: 'batch',
        batchId: 'batch-1',
        templateId: 'template-1',
        certificateName: 'Node Course',
        durationText: '12 weeks',
        completionDate: '2026-05-25',
      },
    };
    const res = createMockRes();
    const next = jest.fn();

    await certificateController.generateCertificates(req, res, next);

    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      data: expect.objectContaining({
        jobId: 'job-new',
        status: 'queued',
        idempotent: false,
      }),
    }));
    expect(next).not.toHaveBeenCalled();
  });

  test('creates replacement job after failed prior run (retry path)', async () => {
    CertificateJob.findOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue(null),
    });
    enqueue.mockResolvedValue({
      _id: 'job-retry',
      status: 'queued',
    });

    const req = {
      user: { id: 'admin-1' },
      body: {
        mode: 'individual',
        studentId: 'student-1',
        templateId: 'template-1',
        certificateName: 'Node Course',
        durationText: '12 weeks',
        completionDate: '2026-05-25',
        forceRegenerate: true,
      },
    };
    const res = createMockRes();
    const next = jest.fn();

    await certificateController.generateCertificates(req, res, next);

    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({
      status: 'queued',
      requestedBy: 'admin-1',
      payload: expect.objectContaining({ mode: 'individual', studentId: 'student-1' }),
    }));
    expect(res.status).toHaveBeenCalledWith(200);
    expect(next).not.toHaveBeenCalled();
  });
});
