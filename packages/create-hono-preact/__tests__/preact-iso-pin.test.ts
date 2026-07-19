import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// This file lives at packages/create-hono-preact/__tests__/, so the repo root
// is three levels up.
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');

const templatePkgPath = resolve(
  here,
  '..',
  'templates',
  'base',
  'package.json'
);
const lockPath = resolve(repoRoot, 'pnpm-lock.yaml');

// The template pins preact-iso to an exact GitHub commit
// (`github:preactjs/preact-iso#<40-hex SHA>`). The workspace consumes the same
// dep via the moving `github:preactjs/preact-iso#v3` tag, which pnpm resolves to
// a concrete codeload tarball SHA in pnpm-lock.yaml. If the workspace re-resolves
// `v3` to a newer commit but the template pin is not re-pinned to match, new
// scaffolds install a DIFFERENT preact-iso than the framework is tested against.
// This guard fails when the two drift apart.
const TEMPLATE_PIN =
  /"preact-iso":\s*"github:preactjs\/preact-iso#([0-9a-f]{40})"/;
const LOCK_RESOLVED =
  /version:\s*https:\/\/codeload\.github\.com\/preactjs\/preact-iso\/tar\.gz\/([0-9a-f]{40})/;

function captureTemplateSha(): string {
  const pkg = readFileSync(templatePkgPath, 'utf8');
  const m = pkg.match(TEMPLATE_PIN);
  expect(
    m,
    `template package.json (${templatePkgPath}) has no pinned "preact-iso": "github:preactjs/preact-iso#<sha>" dependency`
  ).not.toBeNull();
  return m![1];
}

function captureLockSha(): string {
  const lock = readFileSync(lockPath, 'utf8');
  const m = lock.match(LOCK_RESOLVED);
  expect(
    m,
    `pnpm-lock.yaml (${lockPath}) has no resolved preact-iso codeload tarball entry`
  ).not.toBeNull();
  return m![1];
}

describe('preact-iso template pin drift guard', () => {
  it('template pin matches the commit pnpm-lock.yaml resolves for github:preactjs/preact-iso#v3', () => {
    const templateSha = captureTemplateSha();
    const lockSha = captureLockSha();
    expect(
      templateSha,
      `preact-iso pin drift: the scaffold template pins ${templateSha} but the workspace resolves github:preactjs/preact-iso#v3 to ${lockSha}. Re-pin templates/base/package.json to ${lockSha} (or re-run pnpm install) so new scaffolds get the preact-iso the framework is tested against.`
    ).toBe(lockSha);
  });
});
