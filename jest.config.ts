import type { Config } from 'jest';

const config: Config = {
  displayName: 'flowcord',
  testEnvironment: 'node',
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json' }],
  },
  testMatch: ['**/*.spec.ts', '**/*.test.ts'],
  moduleFileExtensions: ['ts', 'js'],
  coverageDirectory: 'coverage',
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.d.ts'],
};

export default config;
