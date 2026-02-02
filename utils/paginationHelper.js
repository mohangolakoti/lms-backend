/**
 * Pagination helper utility
 */

class PaginationHelper {
  /**
   * Parse and validate pagination params
   * @param {number} page - Page number (default 1)
   * @param {number} limit - Items per page (default 10, max 100)
   * @returns {Object} { page, limit, skip }
   */
  static getPaginationParams(page = 1, limit = 10) {
    let pageNum = parseInt(page, 10);
    let limitNum = parseInt(limit, 10);

    // Validate and set defaults
    pageNum = isNaN(pageNum) || pageNum < 1 ? 1 : pageNum;
    limitNum = isNaN(limitNum) || limitNum < 1 ? 10 : limitNum;

    // Cap maximum limit at 100
    limitNum = limitNum > 100 ? 100 : limitNum;

    return {
      page: pageNum,
      limit: limitNum,
      skip: (pageNum - 1) * limitNum,
    };
  }

  /**
   * Apply pagination to query
   * @param {Query} query - Mongoose query
   * @param {number} page - Page number
   * @param {number} limit - Items per page
   * @returns {Query} Paginated query
   */
  static applyPagination(query, page = 1, limit = 10) {
    const { skip, limit: pageLimit } = this.getPaginationParams(page, limit);
    return query.skip(skip).limit(pageLimit);
  }

  /**
   * Get pagination metadata
   * @param {number} total - Total items count
   * @param {number} page - Current page
   * @param {number} limit - Items per page
   * @returns {Object} Pagination metadata
   */
  static getPaginationMeta(total, page, limit) {
    const { page: pageNum, limit: pageLimit } = this.getPaginationParams(page, limit);
    const totalPages = Math.ceil(total / pageLimit);

    return {
      page: pageNum,
      limit: pageLimit,
      total,
      pages: totalPages,
      hasNextPage: pageNum < totalPages,
      hasPrevPage: pageNum > 1,
    };
  }
}

module.exports = PaginationHelper;
