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
    expect(src).toContain(`import { Routes, bootClient } from 'hono-preact';`);
    expect(src).toContain(`import routes from '/proj/src/routes.ts';`);
    // The boot contract is the public one a custom clientEntry follows too;
    // the internal runtime door must not leak into the emitted entry.
    expect(src).not.toContain('hono-preact/internal/runtime');
  });

  it('hydrates into #app', () => {
    const src = generateClientEntrySource({
      routesAbsPath: '/proj/src/routes.ts',
    });
    expect(src).toContain(`document.getElementById('app')`);
  });

  it('calls bootClient() before hydrate()', () => {
    const src = generateClientEntrySource({
      routesAbsPath: '/proj/src/routes.ts',
    });
    const bootIdx = src.indexOf('bootClient();');
    const hydrateIdx = src.indexOf('hydrate(');
    expect(bootIdx).toBeGreaterThan(-1);
    expect(hydrateIdx).toBeGreaterThan(-1);
    expect(bootIdx).toBeLessThan(hydrateIdx);
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
