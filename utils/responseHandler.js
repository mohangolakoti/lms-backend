/**
 * Standardized response handler for all API responses
 */

class ResponseHandler {
  /**
   * Success response
   */
  static success(res, data, message = 'Success', statusCode = 200) {
    if (res.headersSent) {
      console.error('ResponseHandler.success: Headers already sent');
      return res;
    }
    
    res.status(statusCode).json({
      success: true,
      message,
      data,
      timestamp: new Date().toISOString(),
    });
    
    return res;
  }

  /**
   * Error response
   */
  static error(res, error, statusCode = 500, additionalData = null) {
    if (res.headersSent) {
      console.error('ResponseHandler.error: Headers already sent');
      return res;
    }
    
    const message = error?.message || 'Internal server error';
    const isDevelopment = process.env.NODE_ENV === 'development';

    res.status(statusCode).json({
      success: false,
      message,
      error: isDevelopment ? error?.stack : undefined,
      data: additionalData,
      timestamp: new Date().toISOString(),
    });
    
    return res;
  }

  /**
   * Paginated response
   */
  static paginated(res, data, pagination, message = 'Success', statusCode = 200) {
    if (res.headersSent) {
      console.error('ResponseHandler.paginated: Headers already sent');
      return res;
    }
    
    res.status(statusCode).json({
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
    
    return res;
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
    if (res.headersSent) {
      console.error('ResponseHandler.noContent: Headers already sent');
      return res;
    }
    
    res.status(204).send();
    
    return res;
  }
}

module.exports = ResponseHandler;
