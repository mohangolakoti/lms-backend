module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js'],
  verbose: true,
  testTimeout: 30000,
  collectCoverageFrom: [
    'controllers/authController.js',
    'routes/auth.js',
    'middleware/auth.js',
  ],
  coverageThreshold: {
    global: {
      lines: 45,
      statements: 45,
      functions: 40,
      branches: 30,
    },
  },
};
