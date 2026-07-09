import { describe, it, expect, vi, afterEach } from 'vitest';
import { makeAssetsPreloadReader } from '../preload-reader.js';
import { runWithRealtimeRuntime, type RealtimeRuntime } from '../cf-pubsub.js';

function runtimeWith(assets: unknown): RealtimeRuntime {
  return {
    env: { ASSETS: assets },
    ctx: { waitUntil: vi.fn() },
  } as unknown as RealtimeRuntime;
}

function fakeAssets(fetchImpl: (req: Request) => Promise<Response>) {
  return { fetch: fetchImpl };
}

async function runReader(runtime: RealtimeRuntime): Promise<unknown> {
  const reader = makeAssetsPreloadReader();
  return runWithRealtimeRuntime(runtime.env, runtime.ctx, () => reader());
}

// import.meta.env.PROD is a real, mutable property under vitest (Vite's
// define replacement produces a plain object here, not a frozen one); each
// PROD-gating test restores it so the default (false, matching `vite dev`)
// doesn't leak across tests.
afterEach(() => {
  import.meta.env.PROD = false;
});

describe('makeAssetsPreloadReader', () => {
  it('resolves the parsed JSON body on a successful fetch', async () => {
    const artifact = { closure: ['/static/a.js'] };
    const runtime = runtimeWith(
      fakeAssets(async () => new Response(JSON.stringify(artifact)))
    );
    await expect(runReader(runtime)).resolves.toEqual(artifact);
  });

  it('degrades to {} when no ASSETS binding is configured', async () => {
    const runtime = runtimeWith(undefined);
    await expect(runReader(runtime)).resolves.toEqual({});
  });

  it('degrades to {} when the bound value is not fetcher-shaped', async () => {
    const runtime = runtimeWith('not-a-fetcher');
    await expect(runReader(runtime)).resolves.toEqual({});
  });

  it('degrades to {} on a non-OK response', async () => {
    const runtime = runtimeWith(
      fakeAssets(async () => new Response(null, { status: 404 }))
    );
    await expect(runReader(runtime)).resolves.toEqual({});
  });

  it('degrades to {} when the fetch itself throws', async () => {
    const runtime = runtimeWith(
      fakeAssets(async () => {
        throw new Error('network down');
      })
    );
    await expect(runReader(runtime)).resolves.toEqual({});
  });

  it('degrades to {} when the response body is not valid JSON', async () => {
    const runtime = runtimeWith(
      fakeAssets(async () => new Response('not json{'))
    );
    await expect(runReader(runtime)).resolves.toEqual({});
  });

  describe('degraded-read observability', () => {
    it('stays silent in dev (import.meta.env.PROD false, matching wrangler dev)', async () => {
      import.meta.env.PROD = false;
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const runtime = runtimeWith(undefined);
        await runReader(runtime);
        expect(warn).not.toHaveBeenCalled();
      } finally {
        warn.mockRestore();
      }
    });

    it('warns once per failure mode in prod: no binding', async () => {
      import.meta.env.PROD = true;
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        await runReader(runtimeWith(undefined));
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.mock.calls[0]?.[0]).toContain('no ASSETS binding');
      } finally {
        warn.mockRestore();
      }
    });

    it('warns in prod: non-OK response names the HTTP status', async () => {
      import.meta.env.PROD = true;
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        await runReader(
          runtimeWith(
            fakeAssets(async () => new Response(null, { status: 503 }))
          )
        );
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.mock.calls[0]?.[0]).toContain('HTTP 503');
      } finally {
        warn.mockRestore();
      }
    });

    it('warns in prod: a thrown fetch names the failure and passes the error', async () => {
      import.meta.env.PROD = true;
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const thrown = new Error('network down');
        await runReader(
          runtimeWith(
            fakeAssets(async () => {
              throw thrown;
            })
          )
        );
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.mock.calls[0]?.[0]).toContain('fetch threw');
        expect(warn.mock.calls[0]?.[1]).toBe(thrown);
      } finally {
        warn.mockRestore();
      }
    });

    it('warns in prod: a JSON parse failure names the failure', async () => {
      import.meta.env.PROD = true;
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        await runReader(
          runtimeWith(fakeAssets(async () => new Response('not json{')))
        );
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.mock.calls[0]?.[0]).toContain('failed to parse as JSON');
      } finally {
        warn.mockRestore();
      }
    });

    it('does not warn in prod on a successful read', async () => {
      import.meta.env.PROD = true;
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        await runReader(
          runtimeWith(fakeAssets(async () => new Response('{}')))
        );
        expect(warn).not.toHaveBeenCalled();
      } finally {
        warn.mockRestore();
      }
    });
  });
});
