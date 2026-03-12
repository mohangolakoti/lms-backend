const Batch = require('../models/Batch');
const Student = require('../models/User');
const logger = require('../utils/logger');
const ResponseHandler = require('../utils/responseHandler');
const PaginationHelper = require('../utils/paginationHelper');
const QueryOptimizer = require('../utils/queryOptimizer');
const { ValidationError, NotFoundError, ConflictError } = require('../utils/errors');

/**
 * Create a new batch
 * Multiple batches can be active simultaneously
 */
exports.createBatch = async (req, res, next) => {
  try {
    const { name } = req.body;

    // Validation
    if (!name || typeof name !== 'string') {
      throw new ValidationError('Batch name is required and must be a string');
    }

    if (name.trim().length < 2) {
      throw new ValidationError('Batch name must be at least 2 characters');
    }

    // Check for duplicate (case-insensitive)
    const normalizedName = name.trim().toLowerCase();
    const existingBatch = await Batch.withDeleted().findOne({
      name: normalizedName,
      isDeleted: false,
    });

    if (existingBatch) {
      throw new ConflictError('A batch with this name already exists');
    }

    // Create new batch (active by default, no auto-deactivation of others)
    const newBatch = await Batch.create({
      name: normalizedName,
      isActive: true,
    });

    logger.info(`Batch created: ${newBatch._id} by user: ${req.user?._id}`);

    return ResponseHandler.created(res, newBatch, 'Batch created successfully');
  } catch (error) {
    next(error);
  }
};

/**
 * Get all batches with pagination
 */
exports.getAllBatches = async (req, res, next) => {
  try {
    const { isActive, page, limit, sortBy, sortOrder } = req.query;

    // Build filter
    const filter = QueryOptimizer.buildFilter(
      { isActive: isActive !== undefined ? isActive === 'true' : undefined },
      ['isActive']
    );

    // Get total count
    const total = await Batch.countDocuments(filter);

    // Get pagination params
    const { page: pageNum, limit: pageLimit, skip } = PaginationHelper.getPaginationParams(page, limit);

    // Build and execute query
    const batches = await Batch.find(filter)
      .sort(QueryOptimizer.buildSort(sortBy || 'createdAt', sortOrder || -1))
      .skip(skip)
      .limit(pageLimit)
      .lean();

    const pagination = PaginationHelper.getPaginationMeta(total, pageNum, pageLimit);

    return ResponseHandler.paginated(res, batches, pagination);
  } catch (error) {
    next(error);
  }
};

/**
 * Get single batch by ID
 */
exports.getBatchById = async (req, res, next) => {
  try {
    const { id } = req.params;

    const batch = await Batch.findById(id);

    if (!batch) {
      throw new NotFoundError('Batch');
    }

    return ResponseHandler.success(res, batch);
  } catch (error) {
    next(error);
  }
};

/**
 * Update batch status (activate/deactivate)
 * Multiple batches can be active simultaneously
 */
exports.updateBatchStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { isActive } = req.body;

    // Validation
    if (isActive === undefined || typeof isActive !== 'boolean') {
      throw new ValidationError('isActive must be a boolean value');
    }

    const batch = await Batch.findById(id);

    if (!batch) {
      throw new NotFoundError('Batch');
    }

    // Prevent redundant status updates
    if (batch.isActive === isActive) {
      throw new ValidationError(`Batch is already ${isActive ? 'active' : 'inactive'}`);
    }

    // Update batch status (no auto-deactivation of others)
    batch.isActive = isActive;
    await batch.save();

    // Block/unblock students based on batch status
    await Student.updateMany(
      { role: 'student', batchId: batch._id },
      { batchBlocked: !isActive }
    );

    logger.info(`Batch ${id} status updated to ${isActive} by user: ${req.user?._id}`);

    return ResponseHandler.success(
      res,
      batch,
      `Batch ${isActive ? 'activated' : 'deactivated'} successfully`
    );
  } catch (error) {
    next(error);
  }
};

/**
 * Soft delete batch
 */
exports.deleteBatch = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { hardDelete } = req.query; // Allow hard delete only if explicitly specified

    const batch = await Batch.findById(id);

    if (!batch) {
      throw new NotFoundError('Batch');
    }

    // Don't allow deletion of active batch
    if (batch.isActive) {
      throw new ValidationError('Cannot delete an active batch. Deactivate it first.');
    }

    if (hardDelete === 'true') {
      // Hard delete - be careful
      await Batch.findByIdAndDelete(id);
      logger.warn(`Batch hard deleted: ${id} by user: ${req.user?._id}`);
    } else {
      // Soft delete
      await batch.softDelete();
      logger.info(`Batch soft deleted: ${id} by user: ${req.user?._id}`);
    }

    return ResponseHandler.success(res, null, 'Batch deleted successfully', 200);
  } catch (error) {
    next(error);
  }
};

/**
 * Restore soft-deleted batch
 */
exports.restoreBatch = async (req, res, next) => {
  try {
    const { id } = req.params;

    const batch = await Batch.withDeleted().findById(id);

    if (!batch) {
      throw new NotFoundError('Batch');
    }

    if (!batch.isDeleted) {
      throw new ValidationError('Batch is not deleted');
    }

    await batch.restore();

    logger.info(`Batch restored: ${id} by user: ${req.user?._id}`);

    return ResponseHandler.success(res, batch, 'Batch restored successfully');
  } catch (error) {
    next(error);
  }
};

/**
 * Get active batch
 */
exports.getActiveBatch = async (req, res, next) => {
  try {
    const activeBatch = await Batch.findOne({ isActive: true, isDeleted: false });

    if (!activeBatch) {
      throw new NotFoundError('No active batch found');
    }

    return ResponseHandler.success(res, activeBatch);
  } catch (error) {
    next(error);
  }
};
