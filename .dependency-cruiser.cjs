/**
 * Enforces Architecture §12 module boundaries:
 *   - /packages/domain is framework-agnostic: zero imports from Prisma, Next.js, or any framework.
 *   - /packages/application modules (Identity&Access, Network, ClientLifecycle, Money, Media,
 *     Platform, Notifications) expose only their index.ts barrel to the outside; no reaching into
 *     another module's internals.
 *   - Money never imports ClientLifecycle (or any sibling module) internals directly — it reacts to
 *     domain events instead.
 *   - /packages/ui is consumed only by /apps/web.
 */

const APPLICATION_MODULES = [
  'identity-access',
  'network',
  'client-lifecycle',
  'money',
  'media',
  'platform',
  'notifications',
];

const crossModuleInternalRules = APPLICATION_MODULES.map((mod) => ({
  name: `no-reach-into-${mod}-internals`,
  comment: `Only ${mod}'s index.ts barrel is public. Import from '@fitcrew/application/${mod}', not its internals.`,
  severity: 'error',
  from: { pathNot: `^packages/application/src/${mod}/` },
  to: {
    path: `^packages/application/src/${mod}/.+`,
    pathNot: `^packages/application/src/${mod}/index\\.ts$`,
  },
}));

module.exports = {
  forbidden: [
    {
      name: 'domain-is-framework-agnostic',
      comment: 'packages/domain must have zero imports from Prisma, Next.js, or any framework (Architecture §6.2).',
      severity: 'error',
      from: { path: '^packages/domain/src' },
      to: {
        path: '^(node_modules/(next|react|react-dom|@prisma|prisma)|packages/db|apps/)',
      },
    },
    {
      name: 'money-does-not-import-siblings',
      comment: "Money never imports ClientLifecycle (or any sibling module) internals directly — it reacts to events (Architecture §12).",
      severity: 'error',
      from: { path: '^packages/application/src/money' },
      to: {
        path: '^packages/application/src/(identity-access|network|client-lifecycle|media|platform|notifications)/',
      },
    },
    ...crossModuleInternalRules,
    {
      name: 'ui-only-consumed-by-web',
      comment: 'packages/ui is level-agnostic and consumed by /apps/web only (CLAUDE.md §4).',
      severity: 'error',
      from: { path: '^packages/ui/src' },
      to: { path: '^apps/(?!web)' },
    },
    {
      name: 'no-circular',
      comment: 'Circular dependencies make module boundaries meaningless.',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default'],
    },
  },
};
