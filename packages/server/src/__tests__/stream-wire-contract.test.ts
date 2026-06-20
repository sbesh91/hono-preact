import { describe, it, expect } from 'vitest';
import type { StreamEvent } from '@hono-preact/iso/internal';
import {
  streamBootstrapScript,
  pushScript,
  endScript,
  errorScript,
  HP_STREAM_QUEUE_CAP,
} from '../stream-pump.js';

// The producer half of the streaming wire contract (stream-pump.ts) emits
// hand-authored JS strings; the consumer half (StreamEvent + install
// StreamRegistry in @hono-preact/iso) re-declares the same shape. This test
// runs the emitted bootstrap + chunk scripts and asserts the events they queue
// match `StreamEvent` BOTH at compile time (the `expected` literal must satisfy
// `StreamEvent[]` — catches a consumer-side rename) AND at runtime (the queue
// must equal it — catches a producer-side rename), so the two halves cannot
// desync silently.

type FakeRegistry = {
  queue: unknown[];
  capped: boolean;
  push: (id: string, v: unknown) => void;
  end: (id: string) => void;
  error: (id: string, e: { message: string; name: string }) => void;
};

/** Strip the <script> wrapper and run the body against a controlled window. */
function runScript(scriptHtml: string, win: { __HP_STREAM__?: FakeRegistry }) {
  const body = scriptHtml
    .replace(/^<script>/, '')
    .replace(/<\/script>\s*$/, '');
  const document = { currentScript: { remove() {} } };
  new Function('window', 'document', body)(win, document);
}

describe('streaming wire contract (producer ↔ StreamEvent)', () => {
  it('the bootstrap + chunk scripts queue events matching the StreamEvent union', () => {
    const win: { __HP_STREAM__?: FakeRegistry } = {};
    runScript(streamBootstrapScript(), win);
    const reg = win.__HP_STREAM__!;

    runScript(pushScript('L1', { count: 5 }), win);
    runScript(endScript('L1'), win);
    runScript(errorScript('L2', { message: 'boom', name: 'TypeError' }), win);

    const expected: StreamEvent[] = [
      { type: 'push', loaderId: 'L1', value: { count: 5 } },
      { type: 'end', loaderId: 'L1' },
      {
        type: 'error',
        loaderId: 'L2',
        error: { message: 'boom', name: 'TypeError' },
      },
    ];
    expect(reg.queue).toEqual(expected);
  });

  it('escapes </script> in payloads so the script context cannot break out', () => {
    const win: { __HP_STREAM__?: FakeRegistry } = {};
    runScript(streamBootstrapScript(), win);
    const script = pushScript('L1', { html: '</script><img>' });
    // The raw payload must not contain a literal </script> that would close
    // the tag; jsonForScript escapes '<' to <.
    expect(script).not.toContain('</script><img>');
    runScript(script, win);
    expect(win.__HP_STREAM__!.queue).toEqual([
      { type: 'push', loaderId: 'L1', value: { html: '</script><img>' } },
    ]);
  });

  it('caps the queue and flags `capped` once the bound is exceeded', () => {
    const win: { __HP_STREAM__?: FakeRegistry } = {};
    runScript(streamBootstrapScript(), win);
    const reg = win.__HP_STREAM__!;

    for (let i = 0; i < HP_STREAM_QUEUE_CAP + 5; i++) {
      runScript(pushScript('L', i), win);
    }
    expect(reg.queue.length).toBe(HP_STREAM_QUEUE_CAP);
    expect(reg.capped).toBe(true);
  });
});
