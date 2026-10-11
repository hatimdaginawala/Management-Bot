/** @type {import('jest').Config} */
export default {
  testEnvironment: 'node',
  transform: {},
  testMatch: ['**/tests/**/*.test.js'],
  testTimeout: 30_000,
  setupFilesAfterEnv: ['./tests/setup.js'],
};