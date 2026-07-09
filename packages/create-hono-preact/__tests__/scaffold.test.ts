import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scaffold } from '../lib/scaffold.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const templatesRoot = resolve(here, '..', 'templates');

let workDir: string;
beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'chp-scaffold-'));
});
afterEach(() => rmSync(workDir, { recursive: true, force: true }));

function readPkg(dir: string) {
  return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
}

describe('scaffold', () => {
  it('cloudflare: writes wrangler.jsonc and cloudflare devDeps, no node deps', async () => {
    const target = join(workDir, 'cf');
    await scaffold(target, { adapter: 'cloudflare', ui: false }, templatesRoot);
    expect(existsSync(join(target, 'wrangler.jsonc'))).toBe(true);
    expect(existsSync(join(target, 'src', 'pages', 'home.tsx'))).toBe(true);
    const pkg = readPkg(target);
    expect(pkg.devDependencies).toHaveProperty('wrangler');
    expect(pkg.devDependencies).not.toHaveProperty('@hono/node-server');
    expect(pkg.scripts).toHaveProperty('deploy');
    expect(pkg.dependencies).not.toHaveProperty('hono-preact-ui');
    // hoofd is a required peer of hono-preact; it must be a direct dep so
    // package managers that do not auto-install peers still resolve it.
    expect(pkg.dependencies).toHaveProperty('hoofd');
    expect(pkg.name).toBe('cf');
    // The bundled agent recipes verify with `pnpm typecheck`.
    expect(pkg.scripts.typecheck).toBe('tsc --noEmit');
  });

  it('node: writes node devDeps and start script, no wrangler.jsonc', async () => {
    const target = join(workDir, 'nd');
    await scaffold(target, { adapter: 'node', ui: false }, templatesRoot);
    expect(existsSync(join(target, 'wrangler.jsonc'))).toBe(false);
    const pkg = readPkg(target);
    expect(pkg.devDependencies).toHaveProperty('@hono/node-server');
    expect(pkg.devDependencies).not.toHaveProperty('wrangler');
    expect(pkg.scripts).toHaveProperty('start');
  });

  it('ui on: adds hono-preact-ui and a Dialog import in home.tsx', async () => {
    const target = join(workDir, 'ui');
    await scaffold(target, { adapter: 'node', ui: true }, templatesRoot);
    const pkg = readPkg(target);
    expect(pkg.dependencies).toHaveProperty('hono-preact-ui');
    const home = readFileSync(join(target, 'src', 'pages', 'home.tsx'), 'utf8');
    expect(home).toContain("from 'hono-preact-ui'");
    expect(home).toContain('DialogRoot');
  });

  it('ui off: home.tsx has no hono-preact-ui import', async () => {
    const target = join(workDir, 'noui');
    await scaffold(target, { adapter: 'node', ui: false }, templatesRoot);
    const home = readFileSync(join(target, 'src', 'pages', 'home.tsx'), 'utf8');
    expect(home).not.toContain('hono-preact-ui');
  });

  it('substitutes the project name and copies agent guidance', async () => {
    const target = join(workDir, 'my-app');
    await scaffold(target, { adapter: 'cloudflare', ui: false }, templatesRoot);
    expect(readPkg(target).name).toBe('my-app');
    const layout = readFileSync(join(target, 'src', 'Layout.tsx'), 'utf8');
    expect(layout).toContain('defaultTitle="my-app"');
    expect(layout).not.toContain('{{name}}');
    const home = readFileSync(join(target, 'src', 'pages', 'home.tsx'), 'utf8');
    expect(home).not.toContain('{{name}}');
    expect(existsSync(join(target, 'AGENTS.md'))).toBe(true);
    expect(existsSync(join(target, '.gitignore'))).toBe(true);
  });
});

describe('feature/ui home.tsx parity with base', () => {
  // The UI overlay forks the whole home page (overlays are file-granular), so
  // guard the shared core: if a base edit changes the loader usage or the
  // welcome copy, the UI overlay must be updated to match or this fails.
  it('keeps the base loader usage and welcome copy', () => {
    const baseHome = readFileSync(
      join(templatesRoot, 'base', 'src', 'pages', 'home.tsx'),
      'utf8'
    );
    const uiHome = readFileSync(
      join(templatesRoot, 'feature', 'ui', 'src', 'pages', 'home.tsx'),
      'utf8'
    );
    for (const marker of [
      'serverLoaders.default.View(',
      'definePage(HomeView)',
      "Welcome to {'{{name}}'}",
    ]) {
      expect(baseHome).toContain(marker);
      expect(uiHome).toContain(marker);
    }
  });
});

describe('base routes.ts idioms', () => {
  const routes = readFileSync(
    join(templatesRoot, 'base', 'src', 'routes.ts'),
    'utf8'
  );

  it('relies on .server.ts auto-discovery (no explicit server: wiring)', () => {
    expect(routes).not.toContain('server:');
  });

  it('registers the route tree for typed params and paths', () => {
    expect(routes).toContain('as const');
    expect(routes).toContain('interface RegisteredRoutes');
    expect(routes).toContain('RoutePaths<typeof routeTree>');
  });
});
