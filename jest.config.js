/** @type {import('jest').Config} */
module.exports = {
  displayName: 'flowcord',
  testEnvironment: 'node',
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.test.json' }],
  },
  testMatch: ['**/*.test.ts'],
  moduleFileExtensions: ['ts', 'js'],
  coverageDirectory: 'coverage',
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/testing/**',       // test infrastructure (SimulatedAdapter, createTestSession, stubs)
    '!src/tracing/**',       // EventLog — wired but not yet exercised via public API
    '!src/**/__tests__/**',  // test files themselves
  ],
  passWithNoTests: true,
};
