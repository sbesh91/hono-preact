import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import { clientEntryContractPlugin } from '../client-entry-contract.js';

type TransformCtx = { warn: (msg: string) => void };

// Drives configResolved + transform the same way the other plugin tests in
// this folder do: structural casts over the plugin object.
function drive(entry: string, opts: { command?: string; root?: string } = {}) {
  const plugin = clientEntryContractPlugin(entry);
  (
    plugin as {
      configResolved?: (c: { root: string; command: string }) => void;
    }
  ).configResolved?.({
    root: opts.root ?? '/proj',
    command: opts.command ?? 'serve',
  });
  const warnings: string[] = [];
  const ctx: TransformCtx = { warn: (m) => warnings.push(m) };
  const transform = (code: string, id: string) =>
    (
      plugin as {
        transform?: (this: TransformCtx, code: string, id: string) => void;
      }
    ).transform?.call(ctx, code, id);
  return { warnings, transform };
}

describe('clientEntryContractPlugin', () => {
  it('does not apply to the framework virtual entry', () => {
    const plugin = clientEntryContractPlugin('virtual:hono-preact/client');
    const apply = (plugin as { apply?: () => boolean }).apply;
    expect(typeof apply).toBe('function');
    expect(apply!()).toBe(false);
  });

  it('applies to a disk-based custom entry', () => {
    const plugin = clientEntryContractPlugin('src/main.tsx');
    const apply = (plugin as { apply?: () => boolean }).apply;
    expect(apply!()).toBe(true);
  });

  it('warns once in dev when the custom entry never references bootClient', () => {
    const { warnings, transform } = drive('src/main.tsx');
    const entryId = path.resolve('/proj', 'src/main.tsx');
    transform(
      `import { hydrate } from 'preact';\nhydrate(null, document.body);\n`,
      entryId
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('bootClient');
    // The scan only inspects the entry module itself; the message says so, so
    // a reader who delegates booting to an imported module knows to ignore it.
    expect(warnings[0]).toContain('only inspects the entry module itself');
    // An HMR re-transform must not warn again.
    transform(`import { hydrate } from 'preact';\n`, entryId);
    expect(warnings).toHaveLength(1);
  });

  it('matches the entry id with a query suffix', () => {
    const { warnings, transform } = drive('src/main.tsx');
    transform(`export {};\n`, path.resolve('/proj', 'src/main.tsx') + '?v=1');
    expect(warnings).toHaveLength(1);
  });

  it('does not warn when the entry references bootClient', () => {
    const { warnings, transform } = drive('src/main.tsx');
    transform(
      `import { bootClient } from 'hono-preact';\nbootClient();\n`,
      path.resolve('/proj', 'src/main.tsx')
    );
    expect(warnings).toHaveLength(0);
  });

  it('does not warn for other modules', () => {
    const { warnings, transform } = drive('src/main.tsx');
    transform(`export {};\n`, path.resolve('/proj', 'src/other.tsx'));
    expect(warnings).toHaveLength(0);
  });

  it('does not match a longer path sharing the entry prefix', () => {
    const { warnings, transform } = drive('src/main.tsx');
    transform(`export {};\n`, path.resolve('/proj', 'src/main.tsx.bak'));
    expect(warnings).toHaveLength(0);
  });

  it('does not warn during build', () => {
    const { warnings, transform } = drive('src/main.tsx', {
      command: 'build',
    });
    transform(`export {};\n`, path.resolve('/proj', 'src/main.tsx'));
    expect(warnings).toHaveLength(0);
  });
});
