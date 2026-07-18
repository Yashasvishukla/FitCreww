// Root ESLint flat config for the whole monorepo (CLAUDE.md §4).
// Module boundaries are enforced separately by dependency-cruiser (.dependency-cruiser.cjs).
import base from './packages/config/eslint-base.js';

export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/.turbo/**',
      '**/coverage/**',
      '**/prisma/**',
    ],
  },
  ...base,
];
