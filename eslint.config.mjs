import nx from '@nx/eslint-plugin';

export default [
  ...nx.configs['flat/base'],
  ...nx.configs['flat/typescript'],
  ...nx.configs['flat/javascript'],
  {
    ignores: ['**/dist', '**/out-tsc', '**/vitest.config.*.timestamp*'],
  },
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    rules: {
      '@nx/enforce-module-boundaries': [
        'error',
        {
          enforceBuildableLibDependency: true,
          allow: ['^.*/eslint(\\.base)?\\.config\\.[cm]?[jt]s$'],
          depConstraints: [
            {
              sourceTag: 'type:core',
              onlyDependOnLibsWithTags: ['type:core'],
            },
            {
              sourceTag: 'type:domain',
              onlyDependOnLibsWithTags: ['type:core', 'type:domain'],
            },
            {
              sourceTag: 'type:feature',
              onlyDependOnLibsWithTags: [
                'type:core',
                'type:domain',
                'type:tooling',
              ],
            },
            {
              sourceTag: 'type:tooling',
              onlyDependOnLibsWithTags: ['type:core', 'type:tooling'],
            },
          ],
        },
      ],
    },
  },
];
