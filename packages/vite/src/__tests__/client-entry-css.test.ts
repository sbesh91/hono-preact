import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  clientEntryPlugin,
  generateClientEntrySource,
  VIRTUAL_CLIENT_ENTRY_ID,
} from '../client-entry.js';

describe('client entry global CSS import', () => {
  it('imports the global stylesheet first when configured', () => {
    const src = generateClientEntrySource({
      routesAbsPath: '/proj/src/routes.ts',
      cssGlobalAbsPath: '/proj/src/styles/root.css',
    });
    expect(src.startsWith(`import "/proj/src/styles/root.css";`)).toBe(true);
  });

  it('emits no CSS import when not configured', () => {
    const src = generateClientEntrySource({
      routesAbsPath: '/proj/src/routes.ts',
    });
    expect(src).not.toContain('.css');
  });

  it('normalizes a win32-shaped absolute path to forward slashes and quotes it as a JS string literal', () => {
    const src = generateClientEntrySource({
      routesAbsPath: '/proj/src/routes.ts',
      cssGlobalAbsPath: 'C:\\Users\\dev\\app\\src\\styles\\root.css',
    });
    expect(src).toContain(`import "C:/Users/dev/app/src/styles/root.css";\n`);
    expect(src).not.toContain('\\');
  });
});

// Drives the plugin through its Vite hooks (configResolved -> load) the same
// way client-entry.test.ts does, so the build-only gate is covered where it
// lives: a regression that drops the isBuild guard in load() fails here.
// configResolved now also validates cssGlobal against the real filesystem
// (see client-entry.test.ts's "css.global validation" describe block), so
// this fixture needs a real file under a real root rather than the fictional
// '/proj' path used elsewhere in this file for the pure-function tests above.
function loadEntrySource(
  command: 'serve' | 'build',
  root: string
): string | undefined {
  const plugin = clientEntryPlugin({
    routes: 'src/routes.ts',
    cssGlobal: 'src/styles/root.css',
  });
  (
    plugin as {
      configResolved?: (c: { root: string; command: string }) => void;
    }
  ).configResolved?.({ root, command });
  return (plugin as { load?: (id: string) => string | undefined }).load?.(
    '\0' + VIRTUAL_CLIENT_ENTRY_ID
  );
}

describe('clientEntryPlugin build-only CSS import gate', () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hono-preact-css-gate-'));
    fs.mkdirSync(path.join(tmpRoot, 'src', 'styles'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpRoot, 'src', 'styles', 'root.css'),
      'body{color:red}'
    );
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('build mode: the generated entry imports the stylesheet first', () => {
    const code = loadEntrySource('build', tmpRoot);
    expect(code).toBeDefined();
    const cssAbs = path.resolve(tmpRoot, 'src/styles/root.css');
    expect(code!.startsWith(`import ${JSON.stringify(cssAbs)};`)).toBe(true);
  });

  it('serve mode: the generated entry has no CSS import (dev FOUC guard)', () => {
    const code = loadEntrySource('serve', tmpRoot);
    expect(code).toBeDefined();
    expect(code).not.toContain('.css');
    // The rest of the entry is unaffected by the gate.
    expect(code).toContain(
      `import routes from '${path.resolve(tmpRoot, 'src/routes.ts')}';`
    );
  });
});
