import { afterEach, describe, expect, it, vi } from 'vitest';
import { CHANNEL_HEADER } from '../channel-wire.js';
import { readChannelValue, resetChannelStore } from '../channel-store.js';
import { fetchLoaderData } from '../loader-fetch.js';

afterEach(() => {
  vi.unstubAllGlobals();
  resetChannelStore();
});

function stubFetch(headers: Record<string, string>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(JSON.stringify({ results: {} }), {
          status: 200,
          headers: { 'content-type': 'application/json', ...headers },
        })
    )
  );
}

function runFetchLoaderData() {
  const controller = new AbortController();
  return fetchLoaderData(
    'pages/movies',
    'default',
    { path: '/movies', pathParams: {}, searchParams: {} },
    controller.signal
  ).first;
}

describe('fetchLoaderData channel header', () => {
  it('applies a snapshot from the response header', async () => {
    stubFetch({ [CHANNEL_HEADER]: '{"demo":{"signedIn":true}}' });
    await runFetchLoaderData();
    expect(readChannelValue('demo')).toEqual({ signedIn: true });
  });

  it('leaves the store alone when the response carries no header', async () => {
    resetChannelStore();
    stubFetch({ [CHANNEL_HEADER]: '{"demo":1}' });
    await runFetchLoaderData();
    stubFetch({});
    await runFetchLoaderData();
    expect(readChannelValue('demo')).toBe(1);
  });

  it('preserves a channel the new snapshot omits', async () => {
    stubFetch({ [CHANNEL_HEADER]: '{"demo":1}' });
    await runFetchLoaderData();
    stubFetch({ [CHANNEL_HEADER]: '{"other":2}' });
    await runFetchLoaderData();
    expect(readChannelValue('demo')).toBe(1);
    expect(readChannelValue('other')).toBe(2);
  });

  it('takes an explicit falsy publish as the clear', async () => {
    stubFetch({ [CHANNEL_HEADER]: '{"demo":{"signedIn":true}}' });
    await runFetchLoaderData();
    stubFetch({ [CHANNEL_HEADER]: '{"demo":{"signedIn":false}}' });
    await runFetchLoaderData();
    expect(readChannelValue('demo')).toEqual({ signedIn: false });
  });
});
