/**
 * Query optimization helpers
 */

class QueryOptimizer {
  /**
   * Build safe filter object with validation
   */
  static buildFilter(input = {}, allowedFields = []) {
    const filter = {};

    for (const field of allowedFields) {
      if (input[field] !== undefined && input[field] !== null && input[field] !== '') {
        // Special handling for enum fields
        if (Array.isArray(input[field])) {
          filter[field] = { $in: input[field] };
        } else {
          filter[field] = input[field];
        }
      }
    }

    return filter;
  }

  /**
   * Build regex search filter
   */
  static buildSearchFilter(searchTerm, searchFields = ['name', 'email']) {
    if (!searchTerm || searchTerm.trim() === '') {
      return {};
    }

    const escapedTerm = searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = { $regex: escapedTerm, $options: 'i' };

    return {
      $or: searchFields.map(field => ({ [field]: regex })),
    };
  }

  /**
   * Apply lean to reduce memory usage
   */
  static applyLean(query, shouldLean = true) {
    return shouldLean ? query.lean() : query;
  }

  /**
   * Safe populate with error handling
   */
  static safePopulate(query, populations = []) {
    if (!Array.isArray(populations)) {
      return query;
    }

    for (const pop of populations) {
      query = query.populate(pop);
    }

    return query;
  }

  /**
   * Build sort object
   */
  static buildSort(sortBy = 'createdAt', sortOrder = -1) {
    const validOrders = [-1, 1, 'asc', 'desc'];
    let order = validOrders.includes(sortOrder) ? sortOrder : -1;

    if (order === 'asc') order = 1;
    if (order === 'desc') order = -1;

    return { [sortBy]: order };
  }
}

module.exports = QueryOptimizer;
