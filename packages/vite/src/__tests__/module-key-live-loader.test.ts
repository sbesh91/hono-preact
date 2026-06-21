import { describe, it, expect } from 'vitest';
import { moduleKeyPlugin } from '../module-key-plugin.js';

function transform(code: string, id: string) {
  const plugin = moduleKeyPlugin();
  // @ts-expect-error minimal Vite config stub for configResolved
  plugin.configResolved?.({ root: '/proj' });
  // @ts-expect-error transform signature
  return plugin.transform?.(code, id) as { code: string } | undefined;
}

describe('moduleKeyPlugin: route.liveLoader', () => {
  it('threads __moduleKey and __loaderName into the single options object', () => {
    const code = [
      `import { serverRoute, publish } from 'hono-preact';`,
      `const route = serverRoute('/board/:projectId');`,
      `export const serverLoaders = {`,
      `  feed: route.liveLoader({ topic: (c) => boardChannel.key({ projectId: c.location.pathParams.projectId }), load: async () => ({ n: 1 }) }),`,
      `};`,
    ].join('\n');
    const out = transform(code, '/proj/src/pages/board.server.ts');
    expect(out?.code).toContain('export const __moduleKey =');
    // merged INTO the object literal (not appended as a 2nd argument):
    expect(out?.code).toMatch(/liveLoader\(\{\s*__moduleKey:/);
    expect(out?.code).toContain(`__loaderName: "feed"`);
    // must NOT have become a two-arg call
    expect(out?.code).not.toMatch(/liveLoader\([^)]*\},\s*\{\s*__moduleKey/);
  });
});
