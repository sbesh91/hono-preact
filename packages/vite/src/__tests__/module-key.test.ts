import { describe, it, expect } from 'vitest';
import { deriveModuleKey } from '../module-key.js';

describe('deriveModuleKey', () => {
  it('produces a forward-slash path relative to root with the .server.ts extension stripped', () => {
    const root = '/Users/me/repo';
    const abs = '/Users/me/repo/apps/app/src/pages/movies.server.ts';
    expect(deriveModuleKey(abs, root)).toBe('apps/app/src/pages/movies');
  });

  it('handles .server.tsx extensions', () => {
    expect(
      deriveModuleKey('/r/src/pages/admin.server.tsx', '/r')
    ).toBe('src/pages/admin');
  });

  it('handles .server.js and .server.jsx extensions', () => {
    expect(deriveModuleKey('/r/a/x.server.js', '/r')).toBe('a/x');
    expect(deriveModuleKey('/r/a/x.server.jsx', '/r')).toBe('a/x');
  });

  it('normalizes Windows-style path separators to forward slashes', () => {
    expect(
      deriveModuleKey('C:\\repo\\src\\pages\\movies.server.ts', 'C:\\repo')
    ).toBe('src/pages/movies');
  });

  it('produces distinct keys for files that share a basename in different folders', () => {
    const root = '/r';
    const a = deriveModuleKey('/r/pages/movies.server.ts', root);
    const b = deriveModuleKey('/r/pages/admin/movies.server.ts', root);
    expect(a).not.toBe(b);
  });

  it('documents out-of-root behavior: callers must verify absPath is inside viteRoot', () => {
    // The helper does not validate; an out-of-root absPath produces a
    // `../`-prefixed string. Callers (the Vite plugins) gate this case
    // with an explicit `id.startsWith(viteRoot)` check before calling.
    const result = deriveModuleKey('/elsewhere/movies.server.ts', '/r');
    expect(result.startsWith('..')).toBe(true);
  });
});
