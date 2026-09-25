module.exports = {
  testEnvironment: 'node',
  testMatch: ['<rootDir>/tests/**/*.test.js'],
  transform: { '^.+\\.[jt]sx?$': ['babel-jest', { presets: ['next/babel'] }] },
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' },
  modulePathIgnorePatterns: ['<rootDir>/.next', '<rootDir>/.next-dev', '<rootDir>/.next-prod', '<rootDir>/graphify-out', '<rootDir>/src/graphify-out'],
  clearMocks: true,
};
