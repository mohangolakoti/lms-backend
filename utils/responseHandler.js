/**
 * Standardized response handler for all API responses
 */

class ResponseHandler {
  /**
   * Success response
   */
  static success(res, data, message = 'Success', statusCode = 200) {
    return res.status(statusCode).json({
      success: true,
      message,
      data,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Error response
   */
  static error(res, error, statusCode = 500, additionalData = null) {
    const message = error?.message || 'Internal server error';
    const isDevelopment = process.env.NODE_ENV === 'development';

    return res.status(statusCode).json({
      success: false,
      message,
      error: isDevelopment ? error?.stack : undefined,
      data: additionalData,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Paginated response
   */
  static paginated(res, data, pagination, message = 'Success', statusCode = 200) {
    return res.status(statusCode).json({
      success: true,
      message,
      data,
      pagination: {
        page: pagination.page,
        limit: pagination.limit,
        total: pagination.total,
        pages: Math.ceil(pagination.total / pagination.limit),
        hasNextPage: pagination.page < Math.ceil(pagination.total / pagination.limit),
        hasPrevPage: pagination.page > 1,
      },
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Created response
   */
  static created(res, data, message = 'Created successfully') {
    return this.success(res, data, message, 201);
  }

  /**
   * No content response
   */
  static noContent(res) {
    return res.status(204).send();
  }
}

module.exports = ResponseHandler;
