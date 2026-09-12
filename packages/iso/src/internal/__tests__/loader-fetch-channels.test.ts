import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHANNEL_HEADER } from '../channel-wire.js';
import { readChannelValue, resetChannelStore } from '../channel-store.js';
import { fetchLoaderData } from '../loader-fetch.js';
import { defineSessionChannel } from '../../session-channel.js';

// Declaring a channel is what installs the store behind the RPC seam, so these
// go through `defineSessionChannel` rather than reaching for the store's
// installer: the contract under test is what an application does, and a test
// that installed it directly would keep passing if declaring a channel stopped
// installing anything.
beforeEach(() => {
  resetChannelStore();
  defineSessionChannel('demo');
});

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

  it('ignores the header entirely when no channel is declared (#400)', async () => {
    // The always-loaded seam is inert until an application declares a channel.
    // With none declared there is no reader, so dropping the snapshot costs
    // nothing -- and this is what keeps the store out of every app's bundle.
    resetChannelStore();
    stubFetch({ [CHANNEL_HEADER]: '{"demo":{"signedIn":true}}' });
    await runFetchLoaderData();
    expect(readChannelValue('demo')).toBeUndefined();
  });

  it('does not seed from the SSR bootstrap after dropping a round-trip', async () => {
    // A channel declared in a lazily-loaded chunk: the seam was inert for a
    // round-trip, so the bootstrap global is older than an answer nobody
    // recorded. Seeding from it would reinstate the value that round-trip
    // cleared, which for a session hint means waving through a visitor the
    // response just signed out. UNKNOWN is the safe reading; the server guard
    // is the authority either way.
    resetChannelStore();
    vi.stubGlobal('__HP_CHANNELS__', { demo: { signedIn: true } });
    stubFetch({ [CHANNEL_HEADER]: '{"demo":{"signedIn":false}}' });
    await runFetchLoaderData();

    defineSessionChannel('demo');
    expect(readChannelValue('demo')).toBeUndefined();
  });

  it('seeds from the SSR bootstrap when no round-trip was dropped', async () => {
    resetChannelStore();
    vi.stubGlobal('__HP_CHANNELS__', { demo: { signedIn: true } });
    defineSessionChannel('demo');
    expect(readChannelValue('demo')).toEqual({ signedIn: true });
  });
});
