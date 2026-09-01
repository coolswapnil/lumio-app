/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo',
  setupFilesAfterFramework: [],
  transformIgnorePatterns: [
    'node_modules/(?!(' +
      '(jest-)?react-native' +
      '|@react-native(-community)?' +
      '|expo(nent)?' +
      '|@expo(nent)?/.*' +
      '|@expo-google-fonts/.*' +
      '|react-navigation' +
      '|@react-navigation/.*' +
      '|@unimodules/.*' +
      '|unimodules' +
      '|sentry-expo' +
      '|native-base' +
      '|react-native-svg' +
      '|react-native-paper' +
      '|react-native-material-you-colors' +
      ')/)',
  ],
  testPathIgnorePatterns: ['/node_modules/', '/android/', '/ios/'],
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.d.ts',
    '!src/types/**',
  ],
  coverageThreshold: {
    global: {
      branches: 60,
      functions: 60,
      lines: 60,
      statements: 60,
    },
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
};
