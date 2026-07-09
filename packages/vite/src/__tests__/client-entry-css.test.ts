import * as path from 'node:path';
import { describe, it, expect } from 'vitest';
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
    expect(src.startsWith(`import '/proj/src/styles/root.css';`)).toBe(true);
  });

  it('emits no CSS import when not configured', () => {
    const src = generateClientEntrySource({
      routesAbsPath: '/proj/src/routes.ts',
    });
    expect(src).not.toContain('.css');
  });
});

// Drives the plugin through its Vite hooks (configResolved -> load) the same
// way client-entry.test.ts does, so the build-only gate is covered where it
// lives: a regression that drops the isBuild guard in load() fails here.
function loadEntrySource(command: 'serve' | 'build'): string | undefined {
  const plugin = clientEntryPlugin({
    routes: 'src/routes.ts',
    cssGlobal: 'src/styles/root.css',
  });
  (
    plugin as {
      configResolved?: (c: { root: string; command: string }) => void;
    }
  ).configResolved?.({ root: '/proj', command });
  return (plugin as { load?: (id: string) => string | undefined }).load?.(
    '\0' + VIRTUAL_CLIENT_ENTRY_ID
  );
}

describe('clientEntryPlugin build-only CSS import gate', () => {
  const cssAbs = path.resolve('/proj', 'src/styles/root.css');

  it('build mode: the generated entry imports the stylesheet first', () => {
    const code = loadEntrySource('build');
    expect(code).toBeDefined();
    expect(code!.startsWith(`import '${cssAbs}';`)).toBe(true);
  });

  it('serve mode: the generated entry has no CSS import (dev FOUC guard)', () => {
    const code = loadEntrySource('serve');
    expect(code).toBeDefined();
    expect(code).not.toContain('.css');
    // The rest of the entry is unaffected by the gate.
    expect(code).toContain(
      `import routes from '${path.resolve('/proj', 'src/routes.ts')}';`
    );
  });
});
