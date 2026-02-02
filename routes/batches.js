const express = require('express');
const router = express.Router();
const {
  createBatch,
  getAllBatches,
  getBatchById,
  updateBatchStatus,
  deleteBatch,
  getActiveBatch,
} = require('../controllers/batchController');
const { protect } = require('../middleware/auth');
const { validate } = require('../middleware/validation');

// Middleware to check if user is admin
const adminOnly = (req, res, next) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({
      success: false,
      message: 'Access denied. Admin only.',
    });
  }
  next();
};

// Apply authentication to all routes
router.use(protect);
router.use(adminOnly);

/**
 * POST /api/admin/batches
 * Create a new batch
 */
router.post('/', createBatch);

/**
 * GET /api/admin/batches
 * Get all batches (with optional filter by isActive status)
 */
router.get('/', getAllBatches);

/**
 * GET /api/admin/batches/active
 * Get the currently active batch
 */
router.get('/active', getActiveBatch);

/**
 * GET /api/admin/batches/:id
 * Get a specific batch by ID
 */
router.get('/:id', getBatchById);

/**
 * PUT /api/admin/batches/:id/status
 * Update batch status (activate/deactivate)
 */
router.put('/:id/status', updateBatchStatus);

/**
 * DELETE /api/admin/batches/:id
 * Delete a batch (only inactive batches can be deleted)
 */
router.delete('/:id', deleteBatch);

module.exports = router;
