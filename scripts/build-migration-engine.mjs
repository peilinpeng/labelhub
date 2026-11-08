import { build } from 'esbuild';
await build({ entryPoints: ['scripts/migration-engine.ts'], outfile: 'apps/api/generated/migration-engine.cjs',
  bundle: true, platform: 'node', target: 'node26', format: 'cjs',
  alias: { '@labelhub/contracts': './packages/contracts/src/index.ts', '@labelhub/schema-core': './packages/schema-core/src/index.ts' },
});

await build({ entryPoints: ['scripts/ai-workflow-engine.ts'], outfile: 'apps/api/generated/ai-workflow-engine.cjs',
  bundle: true, platform: 'node', target: 'node26', format: 'cjs',
  alias: { '@labelhub/contracts': './packages/contracts/src/index.ts', '@labelhub/schema-core': './packages/schema-core/src/index.ts' },
});
