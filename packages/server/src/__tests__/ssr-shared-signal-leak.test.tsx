// Does reading a MODULE-SCOPE signal in a tracking context leak a subscriber
// per server render?
//
// `loader.tsx` shares one `SSR_STREAM_VALUE` across every request (it is never
// mutated, so one instance is safe), and `INERT_FIELD_ERROR_STORE` shares the
// same shape. If the `@preact/signals` Preact adapter installs a per-render
// updater under `preact-render-to-string`, nothing unmounts on the server, so
// nothing disposes it, and the shared signal's subscriber list would grow once
// per request for the life of a worker isolate.
//
// This tests the MECHANISM directly rather than through the loader stack, so it
// stays valid for every shared-signal site rather than just the one.
import { describe, it, expect } from 'vitest';
import { renderToString } from 'preact-render-to-string';
// Through the framework barrel, which is how an app reaches it, and which
// resolves from this package where the raw dependency does not.
import { signal, effect } from '@hono-preact/iso';

/**
 * Count entries on a signal's subscriber list. `@preact/signals-core` mangles
 * `_targets` to `t`, so this reads a private field deliberately, and throws
 * rather than silently reporting 0 if that internal ever moves.
 */
function subscriberCount(sig: unknown): number {
  if (!('t' in (sig as object))) {
    throw new Error(
      'subscriber list not reachable: @preact/signals-core internals moved'
    );
  }
  let n = 0;
  let cur = (sig as { t?: { n?: unknown } }).t;
  while (cur) {
    n++;
    cur = cur.n as { n?: unknown } | undefined;
  }
  return n;
}

describe('a module-scope signal read during SSR', () => {
  it('does not accrue a subscriber per render', () => {
    const shared = signal({ status: 'connecting' });

    function Consumer() {
      // A tracking read, exactly as a `useData` consumer performs on the server.
      const v = shared.value;
      return <span>{v.status}</span>;
    }

    renderToString(<Consumer />);
    const after1 = subscriberCount(shared);

    for (let i = 0; i < 50; i++) renderToString(<Consumer />);
    const after51 = subscriberCount(shared);

    // A per-render leak shows up as ~50 additional subscribers.
    expect(after51 - after1).toBeLessThanOrEqual(1);
  });

  it('CONTROL: the subscriber counter can actually see a subscriber', () => {
    // Without this, a counter that always reported 0 would "clear" the leak
    // above for the wrong reason.
    const s = signal(1);
    expect(subscriberCount(s)).toBe(0);
    const dispose = effect(() => {
      void s.value;
    });
    expect(subscriberCount(s)).toBe(1);
    dispose();
    expect(subscriberCount(s)).toBe(0);
  });
});
