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
    '!src/**/index.ts',      // barrel re-export files (no logic)
    '!src/testing/**',       // test infrastructure — published separately via @flowcord/testing (Phase 3)
    '!src/**/__tests__/**',  // test files themselves
  ],
  passWithNoTests: true,
};
