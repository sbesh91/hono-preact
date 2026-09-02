import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..');
const skillsDir = resolve(here, '..', 'templates', 'agents', 'skills');
const baseTemplate = resolve(here, '..', 'templates', 'base');
const frameworkDist = resolve(repoRoot, 'packages', 'hono-preact', 'dist');

// The scratch projects live under packages/hono-preact/ so that ordinary
// node_modules walk-up resolves preact, hono and @preact/signals exactly the
// way a real install would; only `hono-preact` itself needs a tsconfig path.
const scratchRoot = resolve(
  repoRoot,
  'packages',
  'hono-preact',
  '.recipe-check'
);

const recipes = readdirSync(skillsDir).filter((f) => f.endsWith('.md'));

/**
 * A fenced code block plus the metadata on its info string. Recipes are
 * indented inside numbered steps, so the fence may be indented and the body
 * has to be dedented by the fence's own indentation before it is compiled.
 */
type Snippet = {
  recipe: string;
  lang: string;
  meta: string;
  line: number;
  code: string;
};

function extractSnippets(recipe: string): Snippet[] {
  const text = readFileSync(resolve(skillsDir, recipe), 'utf8');
  const lines = text.split('\n');
  const out: Snippet[] = [];
  for (let i = 0; i < lines.length; i++) {
    const open = /^(\s*)```(\w+)[ \t]*(.*)$/.exec(lines[i]);
    if (!open) continue;
    const [, indent, lang, meta] = open;
    const body: string[] = [];
    let j = i + 1;
    for (; j < lines.length; j++) {
      if (new RegExp(`^${indent}\`\`\`\\s*$`).test(lines[j])) break;
      body.push(
        lines[j].startsWith(indent) ? lines[j].slice(indent.length) : lines[j]
      );
    }
    if (lang === 'ts' || lang === 'tsx') {
      out.push({
        recipe,
        lang,
        meta: meta.trim(),
        line: i + 1,
        code: body.join('\n'),
      });
    }
    i = j;
  }
  return out;
}

const allSnippets = recipes.flatMap(extractSnippets);

function parseMeta(meta: string): { file?: string; reason?: string } {
  const file = /^file=(\S+)$/.exec(meta);
  if (file) return { file: file[1] };
  const skip = /^no-compile=(.+)$/.exec(meta);
  if (skip) return { reason: skip[1].trim() };
  return {};
}

describe('recipe snippets declare how they are checked', () => {
  it('finds snippets to check', () => {
    expect(allSnippets.length).toBeGreaterThan(0);
  });

  // Compiling is the default and opting out is explicit, so a newly added
  // snippet cannot quietly escape the gate by omitting metadata.
  it('every ts/tsx snippet is either compiled or opted out with a reason', () => {
    for (const s of allSnippets) {
      const { file, reason } = parseMeta(s.meta);
      expect(
        file ?? reason,
        `${s.recipe}:${s.line} needs \`file=<path>\` or \`no-compile=<reason>\` on its fence`
      ).toBeTruthy();
      if (reason !== undefined) {
        expect(
          reason.length,
          `${s.recipe}:${s.line} has an empty no-compile reason`
        ).toBeGreaterThan(0);
      }
    }
  });
});

describe('recipe snippets typecheck against the framework', () => {
  beforeAll(() => {
    if (!existsSync(resolve(frameworkDist, 'index.d.ts'))) {
      throw new Error(
        `framework types missing at ${frameworkDist}; run \`pnpm --filter '@hono-preact/*' --filter hono-preact build\` first`
      );
    }
    rmSync(scratchRoot, { recursive: true, force: true });
    mkdirSync(scratchRoot, { recursive: true });
  });

  afterAll(() => rmSync(scratchRoot, { recursive: true, force: true }));

  // One project per recipe: each recipe rewrites `src/routes.ts`, and the
  // `RegisteredRoutes` augmentation in it may only be declared once per
  // program.
  for (const recipe of recipes) {
    const snippets = extractSnippets(recipe).filter(
      (s) => parseMeta(s.meta).file
    );
    const testFn = snippets.length > 0 ? it : it.skip;
    testFn(`${recipe} compiles`, () => {
      const projectDir = resolve(scratchRoot, recipe.replace(/\.md$/, ''));
      cpSync(baseTemplate, projectDir, { recursive: true });

      for (const s of snippets) {
        const target = resolve(projectDir, parseMeta(s.meta).file!);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, `${s.code}\n`);
      }

      writeFileSync(
        resolve(projectDir, 'tsconfig.json'),
        JSON.stringify(
          {
            compilerOptions: {
              target: 'ESNext',
              module: 'ESNext',
              moduleResolution: 'bundler',
              jsx: 'react-jsx',
              jsxImportSource: 'preact',
              strict: true,
              esModuleInterop: true,
              skipLibCheck: true,
              isolatedModules: true,
              noEmit: true,
              lib: ['ESNext', 'DOM'],
              types: [],
              paths: {
                'hono-preact': [resolve(frameworkDist, 'index.d.ts')],
                'hono-preact/*': [resolve(frameworkDist, '*')],
              },
            },
            include: ['src'],
          },
          null,
          2
        )
      );

      try {
        execFileSync(
          resolve(repoRoot, 'node_modules', '.bin', 'tsc'),
          ['--noEmit', '-p', projectDir],
          { encoding: 'utf8', stdio: 'pipe' }
        );
      } catch (err) {
        const e = err as { stdout?: string; stderr?: string };
        throw new Error(
          `${recipe} snippets do not typecheck:\n${e.stdout ?? ''}${e.stderr ?? ''}`
        );
      }
    });
  }
});
