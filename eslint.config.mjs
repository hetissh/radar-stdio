/**
 * @fileoverview ESLint configuration: the Google JavaScript Style Guide and
 * clean-code-javascript rules adopted in AI_CODING_RULES.md. Layout
 * (indentation, quotes, line length) is Prettier's job, so there are no
 * formatting rules here. Run with `npm run lint`.
 */
import js from '@eslint/js';
import jsdoc from 'eslint-plugin-jsdoc';
import globals from 'globals';

const LOOPS =
  'ForStatement, ForInStatement, ForOfStatement, WhileStatement, ' +
  'DoWhileStatement';

const googleStyle = {
  // Declarations: const by default, let when reassigned, never var; one
  // variable per declaration.
  'no-var': 'error',
  'prefer-const': 'error',
  'one-var': ['error', 'never'],
  // Braces for every control structure. The only exception is an if with no
  // else whose whole statement fits on one line (enforced by multi-line).
  'curly': ['error', 'multi-line'],
  'no-restricted-syntax': [
    'error',
    {
      selector:
        "IfStatement[alternate.type][consequent.type!='BlockStatement']",
      message: 'An if with an else needs braces on both branches.',
    },
    {
      selector:
        "IfStatement[alternate.type][alternate.type!='BlockStatement']" +
        "[alternate.type!='IfStatement']",
      message: 'An else needs braces.',
    },
    {
      selector: `:matches(${LOOPS})[body.type!='BlockStatement']`,
      message: 'Loops need braces.',
    },
  ],
  'eqeqeq': ['error', 'always'],
  'prefer-template': 'error',
  'object-shorthand': 'error',
  'prefer-arrow-callback': 'error',
  'prefer-rest-params': 'error',
  'prefer-spread': 'error',
  'no-throw-literal': 'error',
  'new-cap': 'error',
  'guard-for-in': 'error',
  'no-new-wrappers': 'error',
  'no-array-constructor': 'error',
  'no-object-constructor': 'error',
  'camelcase': ['error', { properties: 'never' }],
  'no-param-reassign': 'error',
};

const cleanCode = {
  // At most three parameters; more belong in an options object.
  'max-params': ['error', 3],
  // No mental mapping: names say what they hold. Allowed short names: loop
  // indices, coordinates and sort comparator arguments.
  'id-length': [
    'error',
    {
      min: 2,
      exceptions: ['i', 'j', 'x', 'y', 'a', 'b', '_'],
      properties: 'never',
    },
  ],
  'max-depth': ['error', 4],
  // An empty catch must say (in a comment) why the error is ignored.
  'no-empty': ['error', { allowEmptyCatch: false }],
  'no-console': ['error', { allow: ['warn', 'error', 'table'] }],
};

const jsdocRules = {
  ...jsdoc.configs['flat/recommended-error'].rules,
  // Every function declaration, every method, and every top-level function
  // constant carries JSDoc with typed parameters and return value.
  'jsdoc/require-jsdoc': [
    'error',
    {
      require: {
        FunctionDeclaration: true,
        MethodDefinition: true,
        ClassDeclaration: true,
      },
      contexts: [
        'Program > VariableDeclaration > VariableDeclarator > ' +
          'ArrowFunctionExpression',
        'Property[method=true] > FunctionExpression',
      ],
    },
  ],
  // Google: descriptions may be omitted when the name and type say it all.
  'jsdoc/require-param-description': 'off',
  'jsdoc/require-returns-description': 'off',
  'jsdoc/require-property-description': 'off',
  // Types like Piece are defined once (shared.js) and used across files.
  'jsdoc/no-undefined-types': 'off',
  'jsdoc/tag-lines': 'off',
};

const strict = { ...googleStyle, ...cleanCode, ...jsdocRules };

export default [
  {
    ignores: [
      'node_modules/',
      'legacy_assets/',
      'public/data/',
      'public/assets/',
      'public/js/core/config.js',
      'public/RADAR-Gallery-to-Archive.html',
    ],
  },
  js.configs.recommended,
  {
    plugins: { jsdoc },
    settings: { jsdoc: { mode: 'closure' } },
  },
  {
    // Browser code: classic scripts (not ES modules, so pages also work from
    // file://). Each file names the globals it defines with /* exported */ and
    // the ones it uses from other files with /* global */.
    files: ['public/js/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: globals.browser,
    },
    rules: {
      ...strict,
      'no-implicit-globals': ['error', { lexicalBindings: true }],
    },
  },
  {
    // Cloudflare Pages Functions: ES modules on the Workers runtime.
    files: ['functions/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: globals.worker,
    },
    rules: strict,
  },
  {
    // Tests: Node's built-in test runner.
    files: ['tests/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: globals.node,
    },
    rules: strict,
  },
  {
    files: ['eslint.config.mjs'],
    languageOptions: { sourceType: 'module', globals: globals.node },
    rules: strict,
  },
];
