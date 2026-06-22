// apps/site/scripts/generate-bundled-corpus.ts
// Generates the docs corpus bundled into scaffolded projects
// (packages/create-hono-preact/templates/agents/llms-full.txt). Reuses the
// site's pure generateLlmsFiles. Run from the repo root via:
//   pnpm gen:agents-corpus
// Node runs this .ts directly via native type-stripping.
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateLlmsFiles } from '../src/llms/generate-llms.ts';
import { nav } from '../src/pages/docs/nav.ts';

const here = dirname(fileURLToPath(import.meta.url));
const docsDir = resolve(here, '../src/pages/docs');
const outFile = resolve(
  here,
  '../../../packages/create-hono-preact/templates/agents/llms-full.txt'
);

const { llmsFullTxt } = generateLlmsFiles(nav, docsDir);
mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, llmsFullTxt);
console.log(`wrote ${outFile} (${llmsFullTxt.length} bytes)`);
