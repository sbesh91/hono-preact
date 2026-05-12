import { defineLoader, type LoaderCtx } from '@hono-preact/iso';

export type LiveStats = {
  tick: number;
  visitors: number;
  load: number;
};

const serverLoader = async function* (
  ctx: LoaderCtx
): AsyncGenerator<LiveStats, void, unknown> {
  let tick = 0;
  while (!ctx.signal.aborted) {
    tick++;
    yield {
      tick,
      visitors: 1000 + Math.floor(Math.random() * 50),
      load: Math.random(),
    };
    if (tick >= 30) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
};

export default serverLoader;
export const loader = defineLoader<LiveStats>(serverLoader);
