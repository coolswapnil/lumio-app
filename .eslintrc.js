module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    ecmaFeatures: { jsx: true },
  },
  plugins: ['@typescript-eslint'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
  ],
  env: {
    browser: true,
    node: true,
    es2022: true,
  },
  globals: {
    __DEV__: 'readonly',
    __dirname: 'readonly',
    __filename: 'readonly',
    process: 'readonly',
    module: 'readonly',
    require: 'readonly',
    exports: 'readonly',
  },
  rules: {
    // Disable overly strict rules that generate noise in a React Native / Expo codebase
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/explicit-module-boundary-types': 'off',
    '@typescript-eslint/no-non-null-assertion': 'warn',
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    '@typescript-eslint/no-require-imports': 'off',

    // Style rules
    'no-console': 'off',
    'no-undef': 'off', // handled by TypeScript

    // Control characters are intentional in input-sanitization regexes
    'no-control-regex': 'off',

    // React Native specific
    'no-restricted-globals': 'off',
  },
  ignorePatterns: [
    'node_modules/',
    'android/',
    'ios/',
    '.expo/',
    'dist/',
    'build/',
    'coverage/',
    'scripts/',
    '*.config.js',
    '*.config.ts',
  ],
};
