// @ts-check
const tseslint = require('typescript-eslint');

/** Shared ESLint flat config: TS recommended rules. Module boundaries are enforced by dependency-cruiser (see .dependency-cruiser.cjs), not here. */
module.exports = [
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },
];
