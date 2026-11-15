// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import mermaid from 'astro-mermaid';
import starlightLlmsTxt from 'starlight-llms-txt';
import { createStarlightTypeDocPlugin } from 'starlight-typedoc';

const [coreTypeDoc, coreSidebarGroup] = createStarlightTypeDocPlugin();
const [angularTypeDoc, angularSidebarGroup] = createStarlightTypeDocPlugin();
const [effectTypeDoc, effectSidebarGroup] = createStarlightTypeDocPlugin();
const [eslintTypeDoc, eslintSidebarGroup] = createStarlightTypeDocPlugin();

const sharedTypeDocConfig = {
  excludeInternal: true,
  excludePrivate: true,
  excludeProtected: true,
  readme: 'none',
  treatWarningsAsErrors: true,
  useCodeBlocks: true,
  expandObjects: false,
  parametersFormat: 'table',
  interfacePropertiesFormat: 'table',
  typeDeclarationFormat: 'table',
};

export default defineConfig({
  site: 'https://andreElrico.github.io',
  base: '/matrix-fsm',
  outDir: '../../dist/apps/docs',
  integrations: [
    mermaid({
      autoTheme: true,
    }),
    starlight({
      title: '@matrix-fsm',
      description:
        'Flat 2D Matrix Finite State Machines for TypeScript, Angular SignalStore, and Effect-TS.',
      social: [
        {
          icon: 'github',
          label: 'GitHub',
          href: 'https://github.com/andreElrico/matrix-fsm',
        },
      ],
      sidebar: [
        {
          label: 'Guides',
          items: [
            { label: 'Getting Started', slug: 'guides/getting-started' },
            { label: 'Core Concepts (2D DSL)', slug: 'guides/core-concepts' },
            { label: 'Angular SignalStore & Testing', slug: 'guides/angular-signalstore' },
            { label: 'Effect-TS Integration', slug: 'guides/effect-ts' },
            { label: 'Best Practices & Agent Rules', slug: 'guides/best-practices' },
            { label: 'ESLint Rules Reference', slug: 'guides/eslint-rules' },
          ],
        },
        {
          label: 'API Reference',
          items: [
            coreSidebarGroup,
            angularSidebarGroup,
            effectSidebarGroup,
            eslintSidebarGroup,
          ],
        },
        {
          label: 'AI Agent Docs',
          items: [
            { label: 'llms.txt (Index)', link: '/llms.txt' },
            { label: 'llms-full.txt (All-in-One)', link: '/llms-full.txt' },
          ],
        },
      ],
      plugins: [
        coreTypeDoc({
          entryPoints: ['../../packages/core/src/index.ts'],
          tsconfig: '../../packages/core/tsconfig.lib.json',
          output: 'api/core',
          pagination: true,
          sidebar: {
            label: 'Core (@matrix-fsm/core)',
            collapsed: true,
          },
          typeDoc: sharedTypeDocConfig,
        }),
        angularTypeDoc({
          entryPoints: ['../../packages/angular/src/index.ts'],
          tsconfig: '../../packages/angular/tsconfig.lib.json',
          output: 'api/angular',
          pagination: true,
          sidebar: {
            label: 'Angular (@matrix-fsm/angular)',
            collapsed: true,
          },
          typeDoc: sharedTypeDocConfig,
        }),
        effectTypeDoc({
          entryPoints: ['../../packages/angular/src/effect/index.ts'],
          tsconfig: '../../packages/angular/tsconfig.lib.json',
          output: 'api/angular-effect',
          pagination: true,
          sidebar: {
            label: 'Effect-TS (@matrix-fsm/angular/effect)',
            collapsed: true,
          },
          typeDoc: sharedTypeDocConfig,
        }),
        eslintTypeDoc({
          entryPoints: ['../../packages/eslint-plugin/src/index.ts'],
          tsconfig: '../../packages/eslint-plugin/tsconfig.lib.json',
          output: 'api/eslint-plugin',
          pagination: true,
          sidebar: {
            label: 'ESLint Plugin (@matrix-fsm/eslint-plugin)',
            collapsed: true,
          },
          typeDoc: sharedTypeDocConfig,
        }),
        starlightLlmsTxt({
          projectName: '@matrix-fsm',
          description:
            'Type-safe, zero-JSON-hell flat 2D Matrix Finite State Machine (FSM) and Actor orchestration architecture for TypeScript, Angular SignalStore, and Effect-TS.',
          details:
            'Packages documented: @matrix-fsm/core, @matrix-fsm/angular, @matrix-fsm/angular/effect, and @matrix-fsm/eslint-plugin. (@matrix-fsm/router is currently excluded.)',
          promote: [
            'index*',
            'guides/best-practices*',
            'guides/getting-started*',
            'guides/core-concepts*',
            'guides/angular-signalstore*',
            'guides/effect-ts*',
            'guides/eslint-rules*',
            'api/core/**',
            'api/angular/**',
            'api/angular-effect/**',
            'api/eslint-plugin/**',
          ],
        }),
      ],
    }),
  ],
});
