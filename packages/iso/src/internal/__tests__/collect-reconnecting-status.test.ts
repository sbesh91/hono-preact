// R4 + R5. A collect-mode stream had no way to say "reconnecting with data
// retained", so F3 reused "keep the previous status" as that representation.
// Two things broke on that:
//
//   R4  a reconnect after a mid-stream failure kept `status: 'error'` while
//       clearing `error`, so `toStreamState`'s documented-unreachable
//       `error ?? new Error(...)` fallback fired and replaced the user's real
//       diagnostic with an internal placeholder, for the whole reconnect.
//   R5  neither surface moved, so nothing an author can branch on reported the
//       reconnect: `docs/reloading.mdx` tells them to watch `reloading` or the
//       `revalidating`/`loading` statuses, and none of them fire.
//
// The missing piece was a STATUS, not a workaround: `reconnecting`, carrying the
// retained data.
import { describe, it, expect } from 'vitest';
import {
  createCollectSignals,
  appendCollectChunk,
  beginCollectResubscribe,
  setCollectError,
  foldStream,
} from '../loader-signal.js';

const sum = (acc: number, chunk: unknown) => acc + (chunk as number);

describe('a reconnect over retained chunks reports `reconnecting`', () => {
  it('R5: the status moves, so an author has something to branch on', () => {
    const s = createCollectSignals();
    const folded = foldStream(s, 0, sum);
    appendCollectChunk(s, 7);
    expect(folded.value.status).toBe('open');

    beginCollectResubscribe(s);

    expect(folded.value.status).toBe('reconnecting');
    // And the retained fold stays on screen while it runs.
    expect(folded.value.data).toBe(7);
  });

  it('R4: a reconnect after a failure does NOT fabricate a placeholder error', () => {
    const s = createCollectSignals();
    const folded = foldStream(s, 0, sum);
    appendCollectChunk(s, 7);
    setCollectError(s, new Error('SSE connection lost: 503'));
    expect(folded.value.status).toBe('error');

    beginCollectResubscribe(s);

    // Previously: status stayed `error` while `error` was nulled, so
    // `toStreamState` substituted 'Streaming loader errored before settling.'
    const v = folded.value;
    expect(v.status).toBe('reconnecting');
    expect(JSON.stringify(v)).not.toMatch(/errored before settling/);
    expect(v.data).toBe(7);
  });

  it('still reports `connecting` on a first connect, with nothing retained', () => {
    const s = createCollectSignals();
    const folded = foldStream(s, 0, sum);
    beginCollectResubscribe(s);
    // Nothing to keep showing, so this is a cold connect, not a reconnect.
    expect(folded.value.status).toBe('connecting');
  });

  it('returns to `open` once the new stream delivers', () => {
    const s = createCollectSignals();
    const folded = foldStream(s, 0, sum);
    appendCollectChunk(s, 7);
    beginCollectResubscribe(s);
    appendCollectChunk(s, 5);
    expect(folded.value.status).toBe('open');
    // A new generation: 5, not 12.
    expect(folded.value.data).toBe(5);
  });
});
