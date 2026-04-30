import { defineLoader, createCache, defineAction, type LoaderFn } from '@hono-preact/iso';

// The sentinel is intentionally constructed at runtime (concatenating two
// halves) so that Rollup/Terser cannot constant-fold it away during
// tree-shaking. If the entire `.server.ts` module ends up in the client
// bundle, this exact string MUST appear somewhere in the dist.
const SECRET_HALF_A = 'sentinel-must-not-leak-';
const SECRET_HALF_B = 'XYZ123';
const SUPER_SECRET_DATABASE_URL = SECRET_HALF_A + SECRET_HALF_B;

const serverLoader: LoaderFn<{ secret: string }> = async () => {
  // returning the secret directly keeps tree-shakers from removing it
  return { secret: SUPER_SECRET_DATABASE_URL };
};
export default serverLoader;

export const loader = defineLoader<{ secret: string }>('foo', serverLoader);
export const cache = createCache<{ secret: string }>('foo');

export const serverActions = {
  noop: defineAction<void, { ok: boolean }>(async () => ({ ok: true })),
};
