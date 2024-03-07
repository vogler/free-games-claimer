// https://eslint.org/docs/latest/use/configure/configuration-files-new
// https://eslint.org/docs/latest/use/configure/migration-guide
import js from '@eslint/js';
import globals from 'globals';
import stylistic from '@stylistic/eslint-plugin-js';

export default [
  // https://eslint.org/docs/latest/use/configure/configuration-files-new#globally-ignoring-files-with-ignores
  // object with just `ignores` applies to all configuration objects
  // had `ln -s .gitignore .eslintignore` before, but .eslintignore no longer supported
  {
    ignores: ['data/**'],
  },
  js.configs.recommended, // TODO still needed?
  {
    // files: ['*.js'],
    languageOptions: {
      globals: globals.node,
    },
    plugins: {
      '@stylistic/js': stylistic,
    },
    // https://eslint.org/docs/latest/rules/
    // https://eslint.style/packages/js
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'prefer-const': 'error',
      '@stylistic/js/array-bracket-newline': ['error', 'consistent'],
      '@stylistic/js/array-bracket-spacing': 'error',
      '@stylistic/js/array-element-newline': ['error', 'consistent'],
      '@stylistic/js/arrow-parens': ['error', 'as-needed'],
      '@stylistic/js/arrow-spacing': 'error',
      '@stylistic/js/block-spacing': 'error',
      '@stylistic/js/brace-style': 'error',
      '@stylistic/js/comma-dangle': ['error', 'always-multiline'],
      '@stylistic/js/comma-spacing': 'error',
      '@stylistic/js/comma-style': 'error',
      '@stylistic/js/eol-last': 'error',
      '@stylistic/js/func-call-spacing': 'error',
      '@stylistic/js/function-paren-newline': ['error', 'consistent'],
      '@stylistic/js/implicit-arrow-linebreak': 'error',
      '@stylistic/js/indent': ['error', 2],
      '@stylistic/js/key-spacing': 'error',
      '@stylistic/js/keyword-spacing': 'error',
      '@stylistic/js/linebreak-style': 'error',
      '@stylistic/js/no-extra-parens': 'error',
      '@stylistic/js/no-extra-semi': 'error',
      '@stylistic/js/no-mixed-spaces-and-tabs': 'error',
      '@stylistic/js/no-multi-spaces': 'error',
      '@stylistic/js/no-multiple-empty-lines': 'error',
      '@stylistic/js/no-tabs': 'error',
      '@stylistic/js/no-trailing-spaces': 'error',
      '@stylistic/js/no-whitespace-before-property': 'error',
      '@stylistic/js/nonblock-statement-body-position': 'error',
      '@stylistic/js/object-curly-newline': 'error',
      '@stylistic/js/object-curly-spacing': ['error', 'always'],
      '@stylistic/js/object-property-newline': ['error', { allowAllPropertiesOnSameLine: true }],
      '@stylistic/js/quote-props': ['error', 'as-needed'],
      '@stylistic/js/quotes': ['error', 'single'],
      '@stylistic/js/rest-spread-spacing': 'error',
      '@stylistic/js/semi': 'error',
      '@stylistic/js/semi-spacing': 'error',
      '@stylistic/js/semi-style': 'error',
      '@stylistic/js/space-before-blocks': 'error',
      '@stylistic/js/space-before-function-paren': ['error', { anonymous: 'never', named: 'never', asyncArrow: 'always' }],
      '@stylistic/js/space-in-parens': 'error',
      '@stylistic/js/space-infix-ops': 'error',
      '@stylistic/js/space-unary-ops': 'error',
      '@stylistic/js/spaced-comment': 'error',
      '@stylistic/js/switch-colon-spacing': 'error',
      '@stylistic/js/template-curly-spacing': 'error',
      '@stylistic/js/template-tag-spacing': 'error',
      '@stylistic/js/wrap-regex': 'error',
    },
  },
];
