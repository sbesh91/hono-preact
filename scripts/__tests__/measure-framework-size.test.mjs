import { describe, it, expect, vi } from 'vitest';
import {
  bundleSize,
  measureSectionA,
  measureSectionC,
} from '../measure-framework-size.mjs';
import { FEATURE_MODULES } from '../size-probe-config.mjs';
import { resolve, join } from 'node:path';
import { mkdtempSync, cpSync, rmSync, existsSync } from 'node:fs';

const ISO = resolve('packages/iso/dist');
const UI = resolve('packages/ui/dist');

// Every test here drives real Vite/esbuild builds, and `measureSectionA`
// drives one per feature bucket. That comfortably fits vitest's 5s default in
// isolation and does not when this file runs alongside the other 466 in the
// parallel pool, where it times out.
//
// The timeout is not merely cosmetic. Vitest terminates the worker on a
// timeout, which skips the `finally` blocks that remove the probe and
// dist-copy scratch directories, so a timeout here leaves untracked
// directories behind in the working tree. (`.gitignore` covers the leftovers
// as a backstop, since no `finally` can survive a killed worker.)
vi.setConfig({ testTimeout: 120_000 });

describe('bundleSize', () => {
  it('returns positive gzip for a real iso module', async () => {
    const entry = `export * as m from '${resolve('packages/iso/dist/is-browser.js')}';`;
    expect(await bundleSize(entry, process.cwd())).toBeGreaterThan(0);
  });

  it('excludes peers (external) so a preact-only entry is a tiny shim', async () => {
    expect(await bundleSize(`export * as h from 'preact';`, process.cwd())).toBeLessThan(200);
  });
});

describe('measureSectionA', () => {
  it('returns core plus every feature with non-negative marginal', async () => {
    const a = await measureSectionA(ISO);
    expect(a.core.total).toBeGreaterThan(0);
    expect(a.core.marginal).toBe(a.core.total);
    for (const bucket of Object.keys(FEATURE_MODULES)) {
      expect(a[bucket].total).toBeGreaterThan(0);
      expect(a[bucket].marginal).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('measureSectionC', () => {
  it('returns ui-core plus components with non-negative marginal', async () => {
    const c = await measureSectionC(UI);
    expect(c['ui-core'].total).toBeGreaterThan(0);
    expect(c.dialog.total).toBeGreaterThan(0);
    expect(c.dialog.marginal).toBeGreaterThanOrEqual(0);
  });

  it('returns {} when the ui dist is absent', async () => {
    expect(await measureSectionC(resolve('packages/ui/does-not-exist'))).toEqual({});
  });
});

describe('a manifest module absent from the measured dist', () => {
  // Reproduces the CI crash this guards against: a PR adds a module to a
  // FEATURE_MODULES bucket (this repo added boot-client.js to `runtime`), and
  // the CI size job then measures the BASE ref's dist, which predates that
  // addition and does not contain the file. Without filtering the bucket's
  // module list against the dist being measured, esbuild fails to resolve the
  // missing path and the whole measurement throws.
  it('measures the bucket without it instead of throwing', async () => {
    // The copy lives INSIDE packages/iso, not in os tmpdir. Dist modules import
    // bare specifiers (`@preact/signals`), which esbuild resolves relative to
    // the importing FILE, not to `resolveDir`; under pnpm that package exists
    // only at packages/iso/node_modules. A copy in os tmpdir cannot resolve it
    // and the measurement throws. This also models the real CI job more
    // closely: it measures a base-ref git worktree's dist, which likewise sits
    // inside an installed checkout.
    const tmp = mkdtempSync(
      join(resolve('packages/iso'), 'dist-missing-module-')
    );
    try {
      cpSync(ISO, tmp, { recursive: true });
      rmSync(join(tmp, 'boot-client.js'));
      expect(existsSync(join(tmp, 'boot-client.js'))).toBe(false);

      const a = await measureSectionA(tmp);
      expect(a.runtime.total).toBeGreaterThan(0);
      expect(a.runtime.marginal).toBeGreaterThanOrEqual(0);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('the probe folds Vite\'s full `import.meta.env` gate (#338)', () => {
  // Framework code guards author-facing prose with
  // `typeof import.meta.env === 'undefined' || import.meta.env.SSR ||
  // import.meta.env.DEV`, so a production client build keeps only the short
  // fallback. The probe defined DEV and PROD but not `import.meta.env` itself,
  // so the `typeof` arm never folded, esbuild kept BOTH branches, and every
  // measured row over-reported by the weight of the DEV-only prose.
  // High-entropy, because gzip crushes a repeated character to nothing and the
  // assertion would hold whether or not the branch was folded.
  const PROSE = Array.from({ length: 120 }, (_, i) =>
    ((i * 2654435761) >>> 0).toString(36)
  ).join(' ');
  // `import.meta.env` is assembled rather than spelled, because THIS file is
  // itself transformed by vitest: written literally, Vite's define plugin
  // substitutes its own dev-mode env into the template string, and the probe
  // receives a source that says `DEV: true`. The test then fails against a
  // probe that is working correctly.
  const ENV = ['import', '.meta', '.env'].join('');
  const gated = `
    export const m = (typeof ${ENV} === 'undefined' || ${ENV}.SSR || ${ENV}.DEV)
      ? ${JSON.stringify(PROSE)}
      : 'short';
    globalThis.__probe = m;
  `;
  const folded = `
    export const m = 'short';
    globalThis.__probe = m;
  `;

  it('drops the DEV-only branch instead of shipping it', async () => {
    const withGate = await bundleSize(gated, process.cwd());
    const withoutGate = await bundleSize(folded, process.cwd());
    // Not an equality assertion: the two sources differ slightly even folded.
    // The point is that the prose is gone, not that the bytes match exactly.
    expect(PROSE.length).toBeGreaterThan(600);
    expect(withGate - withoutGate).toBeLessThan(40);
  });
});
