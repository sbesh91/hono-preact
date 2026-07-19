import { describe, it, expect } from 'vitest';
import { moduleKeyPlugin } from '../module-key-plugin.js';
import type { Plugin } from 'vite';

function transform(
  code: string,
  id: string,
  root = '/Users/me/repo'
): string | undefined {
  const plugin = moduleKeyPlugin() as Plugin & {
    transform: any;
    configResolved?: (c: { root: string }) => void;
  };
  plugin.configResolved?.({ root });
  const r = plugin.transform.call({} as any, code, id);
  return typeof r === 'object' ? r.code : r;
}

describe('moduleKeyPlugin: serverActions walking', () => {
  it('injects __module + __action into each defineAction call inside serverActions', () => {
    const code = `
      import { defineAction } from '@hono-preact/iso';
      const schema = {};
      export const serverActions = {
        login: defineAction(async () => ({}), { input: schema }),
        logout: defineAction(async () => ({})),
      };
    `;
    const out =
      transform(code, '/Users/me/repo/src/pages/auth.server.ts') ?? '';
    // 2-arg defineAction(fn, opts): keys MERGED into the existing opts object.
    expect(out).toContain('__module: "src/pages/auth", __action: "login"');
    // The existing opts survive the merge.
    expect(out).toContain('input: schema');
    // 1-arg defineAction(fn): opts APPENDED after the fn.
    expect(out).toContain('__module: "src/pages/auth", __action: "logout"');
  });

  it('injects __module + __action into route.action(...) member-form calls', () => {
    const code = `
      import { serverRoute } from '@hono-preact/iso';
      const route = serverRoute('/login');
      export const serverActions = {
        submit: route.action(async () => ({})),
        submitWithSchema: route.action(async () => ({}), { input: {} }),
      };
    `;
    const out =
      transform(code, '/Users/me/repo/src/pages/login.server.ts') ?? '';
    // 1-arg .action(): opts appended after the fn.
    expect(out).toContain('__module: "src/pages/login", __action: "submit"');
    // 2-arg .action(fn, opts): merged into the existing opts object.
    expect(out).toContain(
      '__module: "src/pages/login", __action: "submitWithSchema"'
    );
    // The route literal must survive the transform.
    expect(out).toContain("serverRoute('/login')");
    // __routeId is NOT injected by the plugin (set at runtime via serverRoute).
    expect(out).not.toContain('__routeId');
  });

  it('threads both loaders and actions in a mixed .server file', () => {
    const code = `
      import { defineLoader, defineAction } from '@hono-preact/iso';
      export const serverLoaders = {
        summary: defineLoader(async () => ({})),
      };
      export const serverActions = {
        save: defineAction(async () => ({})),
      };
    `;
    const out =
      transform(code, '/Users/me/repo/src/pages/movie.server.ts') ?? '';
    expect(out).toContain(
      '__moduleKey: "src/pages/movie", __loaderName: "summary"'
    );
    expect(out).toContain('__module: "src/pages/movie", __action: "save"');
  });

  it('threads a string-literal (hyphenated) action key', () => {
    // A key that is not a bare identifier (`'sign-up'`) must still get the
    // __module/__action threading, or its SSR <Form> would regress to empty
    // hidden fields.
    const code = `
      import { defineAction } from '@hono-preact/iso';
      export const serverActions = {
        'sign-up': defineAction(async () => ({})),
      };
    `;
    const out =
      transform(code, '/Users/me/repo/src/pages/auth.server.ts') ?? '';
    expect(out).toContain('__module: "src/pages/auth", __action: "sign-up"');
  });

  it('skips spread and non-call members of serverActions', () => {
    const code = `
      import { defineAction } from '@hono-preact/iso';
      const base = {};
      export const serverActions = {
        ...base,
        notAnAction: 42,
        real: defineAction(async () => ({})),
      };
    `;
    const out = transform(code, '/Users/me/repo/src/pages/x.server.ts') ?? '';
    expect(out).toContain('__module: "src/pages/x", __action: "real"');
    // The non-call member is left untouched (no keys injected onto it).
    expect(out).not.toContain('__action: "notAnAction"');
  });

  it('does not double-inject on an already-keyed re-transform (HMR guard)', () => {
    const code = `
      import { defineAction } from '@hono-preact/iso';
      export const serverActions = {
        save: defineAction(async () => ({})),
      };
    `;
    const id = '/Users/me/repo/src/pages/y.server.ts';
    const first = transform(code, id) ?? '';
    expect(first).toContain('__module: "src/pages/y", __action: "save"');
    // The keys are injected exactly once (no double-injection within one pass).
    expect(first.match(/__action: "save"/g)).toHaveLength(1);
    // Feeding the already-transformed code back in must be a no-op: the
    // ALREADY_KEYED guard sees the prepended __moduleKey export and bails,
    // returning undefined (Vite's signal to keep the code unchanged).
    const second = transform(first, id);
    expect(second).toBeUndefined();
  });
});
