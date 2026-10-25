module.exports = [
  { ignores: ['node_modules/**', 'data/**', 'logs/**'] },
  { files: ['src/**/*.js', 'scripts/**/*.js', 'test/**/*.js'], languageOptions: { globals: { process: 'readonly', Buffer: 'readonly', console: 'readonly', require: 'readonly', module: 'readonly', __dirname: 'readonly' } }, rules: { 'no-unused-vars': 'warn', 'no-undef': 'warn', eqeqeq: 'warn', 'no-empty': ['warn', { allowEmptyCatch: true }], 'no-prototype-builtins': 'warn' } },
  { files: ['public/**/*.js', 'public-admin/**/*.js'], languageOptions: { globals: { window: 'readonly', document: 'readonly', console: 'readonly', fetch: 'readonly', URL: 'readonly', URLSearchParams: 'readonly', history: 'readonly', location: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly' } }, rules: { 'no-unused-vars': 'warn', 'no-undef': 'warn', eqeqeq: 'warn', 'no-empty': ['warn', { allowEmptyCatch: true }], 'no-prototype-builtins': 'warn' } },
];
