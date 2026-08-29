import { describe, it, expect } from 'vitest';
import { isViteProjectFile } from '../dev-passthrough.js';

/**
 * `isViteProjectFile` answers one question: does this request path name a real
 * file Vite serves out of the project, rather than an application route the SSR
 * app owns? The probe is injected so these stay pure (no temp dirs, no fs).
 */
const opts = (files: string[]) => ({
  root: '/p',
  publicDir: '/p/public',
  fileExists: (abs: string) => files.includes(abs),
});

describe('isViteProjectFile', () => {
  it('claims application source that exists under the project root', () => {
    // The #392 case: the client entry statically imports /src/routes.ts, so
    // handing this to the SSR app makes the whole client graph fail to load.
    expect(
      isViteProjectFile('/src/routes.ts', opts(['/p/src/routes.ts']))
    ).toBe(true);
  });

  it('claims any real project file, not just a known source extension', () => {
    // An imported binary asset is served by Vite exactly like a .ts module is;
    // an extension allowlist would miss these.
    const files = ['/p/src/assets/logo.png', '/p/src/fonts/inter.woff2'];
    expect(isViteProjectFile('/src/assets/logo.png', opts(files))).toBe(true);
    expect(isViteProjectFile('/src/fonts/inter.woff2', opts(files))).toBe(true);
  });

  it('claims files served out of publicDir', () => {
    expect(
      isViteProjectFile('/favicon.ico', opts(['/p/public/favicon.ico']))
    ).toBe(true);
  });

  it('leaves an application route to the SSR app', () => {
    expect(isViteProjectFile('/about', opts([]))).toBe(false);
    expect(isViteProjectFile('/', opts([]))).toBe(false);
    expect(isViteProjectFile('/docs/styling', opts([]))).toBe(false);
  });

  it('leaves a build-generated app URL to the SSR app', () => {
    // /llms.txt and /llms-full.txt are emitted client assets with no file on
    // disk in dev (apps/site/vite.config.ts). An extension allowlist that
    // included .txt would wrongly claim them.
    expect(isViteProjectFile('/llms.txt', opts([]))).toBe(false);
    expect(isViteProjectFile('/llms-full.txt', opts([]))).toBe(false);
  });

  it('refuses to escape the project root via traversal', () => {
    // Never let a crafted URL turn into an existence probe outside the project.
    const probed: string[] = [];
    const seen = {
      root: '/p',
      publicDir: '/p/public',
      fileExists: (abs: string) => {
        probed.push(abs);
        return true;
      },
    };
    expect(isViteProjectFile('/../../etc/passwd', seen)).toBe(false);
    expect(isViteProjectFile('/src/../../etc/passwd', seen)).toBe(false);
    for (const p of probed) {
      expect(p.startsWith('/p/')).toBe(true);
    }
  });

  it('ignores a percent-encoded traversal too', () => {
    expect(
      isViteProjectFile('/%2e%2e/%2e%2e/etc/passwd', {
        root: '/p',
        publicDir: '/p/public',
        fileExists: () => true,
      })
    ).toBe(false);
  });

  it('resolves a decoded path with spaces', () => {
    expect(
      isViteProjectFile('/src/my%20page.tsx', opts(['/p/src/my page.tsx']))
    ).toBe(true);
  });

  it('is not fooled by a NUL byte in the path', () => {
    expect(
      isViteProjectFile('/src/routes.ts\0.png', {
        root: '/p',
        publicDir: '/p/public',
        fileExists: () => true,
      })
    ).toBe(false);
  });

  it('treats a malformed percent-encoding as not-a-file', () => {
    expect(
      isViteProjectFile('/src/%E0%A4%A.ts', {
        root: '/p',
        publicDir: '/p/public',
        fileExists: () => true,
      })
    ).toBe(false);
  });
});
