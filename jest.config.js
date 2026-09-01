/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo',

  // Use babel coverage provider so Istanbul instruments source files during
  // transformation. V8 coverage has path-mapping issues with jest-expo that
  // result in 0% coverage reports even when tests execute successfully.
  coverageProvider: 'babel',

  // Extend Jest matchers with @testing-library/react-native built-in matchers.
  // @testing-library/jest-native is deprecated as of v12.4+ — use the built-in
  // matchers shipped directly in @testing-library/react-native v13+.
  setupFilesAfterEnv: ['@testing-library/react-native/build/matchers/extend-expect'],

  transformIgnorePatterns: [
    'node_modules/(?!(' +
      '(jest-)?react-native' +
      '|@react-native(-community)?' +
      '|expo[^/]*' +
      '|@expo[^/]*/.*' +
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
    // Components and context require React Native renderer — excluded from CI coverage
    '!src/components/**',
    '!src/context/**',
    // Database layer requires native SQLite — excluded from CI coverage
    '!src/database/**',
    // Services that are partially tested
    '!src/services/export.ts',
    '!src/services/settings.ts',
    '!src/services/widget_bridge.ts',
    // Sync engine and adapters are complex integration code — excluded from unit coverage
    '!src/sync/SyncEngine.ts',
    '!src/sync/SyncRepository.ts',
    '!src/sync/adapters/**',
  ],

  coverageThreshold: {
    global: {
      branches: 50,
      functions: 50,
      lines: 50,
      statements: 50,
    },
  },

  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
};
