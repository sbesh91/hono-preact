import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import {
  clientEntryPlugin,
  generateClientEntrySource,
  VIRTUAL_CLIENT_ENTRY_ID,
} from '../client-entry.js';

describe('VIRTUAL_CLIENT_ENTRY_ID', () => {
  it('is the documented virtual module id', () => {
    expect(VIRTUAL_CLIENT_ENTRY_ID).toBe('virtual:hono-preact/client');
  });
});

describe('generateClientEntrySource', () => {
  it('emits the framework imports plus the user routes import (absolute path)', () => {
    const src = generateClientEntrySource({
      routesAbsPath: '/proj/src/routes.ts',
    });

    expect(src).toContain(`import { h, hydrate } from 'preact';`);
    expect(src).toContain(`import { LocationProvider } from 'preact-iso';`);
    expect(src).toContain(`import { Routes } from 'hono-preact';`);
    expect(src).toContain(
      `import { installNavTransitionScheduler, installStreamRegistry, installHistoryShim } from 'hono-preact/internal/runtime';`
    );
    expect(src).toContain(`installHistoryShim();`);
    expect(src).toContain(`installStreamRegistry();`);
    expect(src).toContain(`import routes from '/proj/src/routes.ts';`);
  });

  it('hydrates into #app and wraps navigations in the view-transition coordinator', () => {
    const src = generateClientEntrySource({
      routesAbsPath: '/proj/src/routes.ts',
    });
    expect(src).toContain(`document.getElementById('app')`);
    // The render scheduler is installed so navigations start a transition
    // before the route re-renders.
    expect(src).toContain(`installNavTransitionScheduler();`);
  });

  it('imports installHistoryShim and calls it before installStreamRegistry', () => {
    const src = generateClientEntrySource({
      routesAbsPath: '/proj/src/routes.ts',
    });
    expect(src).toContain('installHistoryShim');
    expect(src).toContain('installStreamRegistry');
    const shimIdx = src.indexOf('installHistoryShim()');
    const streamIdx = src.indexOf('installStreamRegistry()');
    expect(shimIdx).toBeGreaterThan(-1);
    expect(streamIdx).toBeGreaterThan(-1);
    expect(shimIdx).toBeLessThan(streamIdx);
  });

});

describe('clientEntryPlugin', () => {
  it('resolveId returns the resolved id only for the virtual id', () => {
    const plugin = clientEntryPlugin({ routes: 'src/routes.ts' });
    (
      plugin as { configResolved?: (c: { root: string }) => void }
    ).configResolved?.({
      root: '/proj',
    });

    const resolved = (
      plugin as {
        resolveId?: (id: string) => string | undefined;
      }
    ).resolveId?.(VIRTUAL_CLIENT_ENTRY_ID);
    expect(resolved).toBe('\0' + VIRTUAL_CLIENT_ENTRY_ID);

    const other = (
      plugin as {
        resolveId?: (id: string) => string | undefined;
      }
    ).resolveId?.('not-the-virtual');
    expect(other).toBeUndefined();
  });

  it('load() returns the generated source for the resolved virtual id', () => {
    const plugin = clientEntryPlugin({ routes: 'src/routes.ts' });
    (
      plugin as { configResolved?: (c: { root: string }) => void }
    ).configResolved?.({
      root: '/proj',
    });

    const code = (
      plugin as {
        load?: (id: string) => string | undefined;
      }
    ).load?.('\0' + VIRTUAL_CLIENT_ENTRY_ID);

    expect(code).toContain(
      `import routes from '${path.resolve('/proj', 'src/routes.ts')}';`
    );
  });

  it('load() returns undefined for non-virtual ids', () => {
    const plugin = clientEntryPlugin({ routes: 'src/routes.ts' });
    (
      plugin as { configResolved?: (c: { root: string }) => void }
    ).configResolved?.({
      root: '/proj',
    });
    const code = (
      plugin as { load?: (id: string) => string | undefined }
    ).load?.('other-id');
    expect(code).toBeUndefined();
  });
});
