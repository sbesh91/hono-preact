import { defineLoader, defineAction } from '@hono-preact/iso';

// The sentinel is intentionally constructed at runtime (concatenating two
// halves) so that Rollup/Terser cannot constant-fold it away during
// tree-shaking. If the entire `.server.ts` module ends up in the client
// bundle, this exact string MUST appear somewhere in the dist.
const SECRET_HALF_A = 'sentinel-must-not-leak-';
const SECRET_HALF_B = 'XYZ123';
const SUPER_SECRET_DATABASE_URL = SECRET_HALF_A + SECRET_HALF_B;

// This loader ignores its ctx, so it declares no parameter; the return type
// annotation is what `defineLoader`'s overloads discriminate on.
const serverLoader = async (): Promise<{ secret: string }> => {
  // returning the secret directly keeps tree-shakers from removing it
  return { secret: SUPER_SECRET_DATABASE_URL };
};

export const serverLoaders = {
  default: defineLoader<{ secret: string }>(serverLoader),
};

export const serverActions = {
  noop: defineAction<void, { ok: boolean }>(async () => ({ ok: true })),
};
