import { describe, it, expect } from 'vitest';
import { existsSync, globSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import ts from 'typescript';

// The framework packages build with `tsc` against a `tsconfig.json` that
// carries `exclude: ["src/**/__tests__/**"]`. That exclusion is load-bearing:
// without it, test files would be emitted into `dist/` and published to npm.
// The side effect is that no build config ever typechecks a test file, so type
// errors in tests fail nothing. Each such package therefore carries a second
// config, `tsconfig.test.json` (`noEmit`, tests re-included), run by a
// `typecheck:tests` script that the root script fans out to with `pnpm -r`.
//
// `pnpm -r --if-present` is a silent no-op for a package that has no such
// script, so a package could be added tomorrow, hide its tests from its build
// config exactly like the others, and escape the gate with a green CI. These
// tests are what stops that.
//
// The escape hatch that matters is the glob below: a package whose tests this
// file cannot SEE drops out of `WITH_TESTS` and every assertion here passes
// vacuously for it. So `TEST_SOURCES` must keep matching every layout in the
// repo, and "the gate is green" only ever means "green for the files it globs".

const ROOT = resolve(import.meta.dirname, '../..');

// Test sources whose typechecking this gate is responsible for. Two kinds are
// deliberately out of scope:
//   * `*.test-d.ts(x)` are type-level tests run by `pnpm test:types`
//     (vitest's typecheck mode) against the built `dist/`, using vitest type
//     assertion helpers that want that environment.
//   * `__tests__/fixtures/**` are standalone mini-apps compiled by a CHILD
//     Vite process, not part of the enclosing package's program at all. They
//     resolve imports through their own `resolve.alias`, which tsc has no
//     equivalent of.
// Both layouts are covered on purpose. Most packages keep tests under
// `src/**/__tests__/`, but `packages/hono-preact` keeps them at the package
// ROOT (`__tests__/`), outside the `include: ["src/**/*.ts"]` its build config
// declares. Globbing only `src/**` made `ownedTestFiles()` return `[]` for that
// package, which dropped it out of `WITH_TESTS` and made every assertion below
// pass vacuously for it: a gate that looked exhaustive while a package with an
// export-surface test sat entirely outside it.
const TEST_SOURCES = [
  'src/**/__tests__/**/*.ts',
  'src/**/__tests__/**/*.tsx',
  '__tests__/**/*.ts',
  '__tests__/**/*.tsx',
];
const TYPE_LEVEL_TEST = /\.test-d\.tsx?$/;
const CHILD_BUILD_FIXTURE = /(^|\/)__tests__\/fixtures\//;

/** The `packages:` globs from pnpm-workspace.yaml, as written. */
function workspaceGlobs() {
  // A four-line flat sequence of quoted globs. Parsed directly rather than
  // taking on a YAML dependency, but anchored on the block so a `packages:`
  // entry added later is picked up and an unparseable file fails loudly.
  const lines = readFileSync(join(ROOT, 'pnpm-workspace.yaml'), 'utf8').split(
    '\n'
  );
  const start = lines.findIndex((l) => /^packages:\s*$/.test(l));
  if (start === -1) throw new Error('pnpm-workspace.yaml has no packages: key');
  const globs = [];
  for (const line of lines.slice(start + 1)) {
    const item = /^\s+-\s*['"]?([^'"#\s]+)['"]?/.exec(line);
    if (item) globs.push(item[1]);
    else if (line.trim() !== '' && !line.trimStart().startsWith('#')) break;
  }
  if (globs.length === 0) throw new Error('pnpm-workspace.yaml lists no globs');
  return globs;
}

/** Every workspace package directory, repo-relative and posix-separated. */
function workspacePackages() {
  return workspaceGlobs()
    .flatMap((g) => globSync(g, { cwd: ROOT }))
    .map(posix)
    .filter((dir) => existsSync(join(ROOT, dir, 'package.json')))
    .sort();
}

function posix(p) {
  return p.split('\\').join('/');
}

function pkgJson(dir) {
  return JSON.parse(readFileSync(join(ROOT, dir, 'package.json'), 'utf8'));
}

/** Test sources on disk that this gate is responsible for typechecking. */
function ownedTestFiles(dir) {
  return TEST_SOURCES.flatMap((g) => globSync(g, { cwd: join(ROOT, dir) }))
    .map((f) => `${dir}/${posix(f)}`)
    .filter((f) => !TYPE_LEVEL_TEST.test(f) && !CHILD_BUILD_FIXTURE.test(f))
    .sort();
}

/**
 * The exact file set and options tsc would use for a config, resolved through
 * `extends` and the real include/exclude glob semantics. Asking TypeScript
 * beats re-implementing those rules and then trusting the re-implementation.
 */
function program(dir, configName) {
  const configPath = join(ROOT, dir, configName);
  const parsed = ts.getParsedCommandLineOfConfigFile(
    configPath,
    {},
    {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic(d) {
        throw new Error(
          `${dir}/${configName}: ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`
        );
      },
    }
  );
  if (!parsed) throw new Error(`could not parse ${dir}/${configName}`);
  return {
    options: parsed.options,
    files: new Set(parsed.fileNames.map((f) => posix(relative(ROOT, f)))),
  };
}

const PACKAGES = workspacePackages();
const WITH_TESTS = PACKAGES.filter(
  (dir) =>
    existsSync(join(ROOT, dir, 'tsconfig.json')) &&
    ownedTestFiles(dir).length > 0
);

describe('typecheck:tests gate', () => {
  it('enumerates the workspace packages that carry src tests', () => {
    // Sanity anchor: if this list ever empties (a bad glob, a renamed
    // directory), every assertion below would vacuously pass.
    expect(PACKAGES.length).toBeGreaterThan(0);
    expect(WITH_TESTS.length).toBeGreaterThan(0);
  });

  it('gives every package that hides tests from its build config both a tsconfig.test.json and a typecheck:tests script', () => {
    const missing = [];
    for (const dir of WITH_TESTS) {
      const build = program(dir, 'tsconfig.json');
      const hidden = ownedTestFiles(dir).filter((f) => !build.files.has(f));
      // A package whose build config already compiles its own tests (apps/site)
      // is covered by `pnpm typecheck` and needs no second config.
      if (hidden.length === 0) continue;

      if (!existsSync(join(ROOT, dir, 'tsconfig.test.json'))) {
        missing.push(
          `${dir}: excludes ${hidden.length} test file(s) from tsconfig.json but has no tsconfig.test.json`
        );
      }
      if (!pkgJson(dir).scripts?.['typecheck:tests']) {
        missing.push(`${dir}: has no "typecheck:tests" script`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('leaves no test file outside every typechecking program', () => {
    const orphans = [];
    for (const dir of WITH_TESTS) {
      const covered = new Set(program(dir, 'tsconfig.json').files);
      if (existsSync(join(ROOT, dir, 'tsconfig.test.json'))) {
        for (const f of program(dir, 'tsconfig.test.json').files)
          covered.add(f);
      }
      for (const f of ownedTestFiles(dir)) if (!covered.has(f)) orphans.push(f);
    }
    // A test file in no program is typechecked by nothing, which is the whole
    // failure mode. Fix by widening the package's tsconfig.test.json include.
    expect(orphans).toEqual([]);
  });

  it('never lets a tsconfig.test.json emit into dist', () => {
    // These configs compile test files. If one could emit, `tsc -p
    // tsconfig.test.json` would write them under `outDir`, which is exactly
    // what the build config's exclusion exists to prevent.
    const emitting = [];
    for (const dir of PACKAGES) {
      if (!existsSync(join(ROOT, dir, 'tsconfig.test.json'))) continue;
      if (program(dir, 'tsconfig.test.json').options.noEmit !== true) {
        emitting.push(`${dir}/tsconfig.test.json does not set noEmit`);
      }
    }
    expect(emitting).toEqual([]);
  });

  it('keeps test files out of every build config that emits', () => {
    // The invariant the exclusion protects: nothing under __tests__ may reach
    // a published dist/.
    const leaked = [];
    for (const dir of PACKAGES) {
      if (!existsSync(join(ROOT, dir, 'tsconfig.json'))) continue;
      const build = program(dir, 'tsconfig.json');
      if (build.options.noEmit === true) continue;
      for (const f of build.files)
        if (f.includes('/__tests__/')) leaked.push(f);
    }
    expect(leaked).toEqual([]);
  });

  it('fans the root typecheck:tests script out to the workspace', () => {
    const root = pkgJson('.').scripts ?? {};
    expect(root['typecheck:tests']).toBeDefined();
    // Recursive, not a hardcoded package list that would drift from the
    // workspace the assertions above enumerate.
    expect(root['typecheck:tests']).toContain('-r');
    expect(root['typecheck:tests']).toContain('typecheck:tests');
  });
});
