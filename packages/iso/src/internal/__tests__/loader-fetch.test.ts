// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchLoaderData } from '../loader-fetch.js';
import { LoaderValidationError } from '../../loader-validation-error.js';
import { getValidationIssues } from '../../get-validation-issues.js';
import { VALIDATION_ISSUES_KEY } from '../contract.js';

const loc = { path: '/x', pathParams: {}, searchParams: {} };

afterEach(() => {
  vi.restoreAllMocks();
});

describe('fetchLoaderData: separate module + loader args', () => {
  it('puts both module and loader into the request body', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    await fetchLoaderData(
      'pages/movie',
      'summary',
      { path: '/movies/1', pathParams: { id: '1' }, searchParams: {} },
      new AbortController().signal
    ).first;

    const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
    expect(body.module).toBe('pages/movie');
    expect(body.loader).toBe('summary');
  });
});

describe('fetchLoaderData: redirect outcome envelope', () => {
  it('calls window.location.assign and returns a never-settling promise when the response carries a redirect outcome', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ __outcome: 'redirect', to: '/login', status: 302 }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    );
    const assignSpy = vi.fn();
    // happy-dom's window.location is read-only; replace just assign.
    Object.defineProperty(window.location, 'assign', {
      configurable: true,
      value: assignSpy,
    });

    const p = fetchLoaderData(
      'm',
      'default',
      loc,
      new AbortController().signal
    ).first;
    // Race against a short timeout to confirm the promise does NOT settle.
    const result = await Promise.race([
      p,
      new Promise<'pending'>((r) => setTimeout(() => r('pending'), 20)),
    ]);
    expect(result).toBe('pending');
    expect(assignSpy).toHaveBeenCalledWith('/login');
  });

  it('returns the JSON value when the response is a plain object (not a redirect outcome)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ movies: [1, 2, 3] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    const result = await fetchLoaderData(
      'm',
      'default',
      loc,
      new AbortController().signal
    ).first;
    expect(result).toEqual({ movies: [1, 2, 3] });
  });
});

describe('fetchLoaderData: deny outcome envelope', () => {
  it('throws an Error with the deny message when the envelope carries one', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ __outcome: 'deny', message: 'Forbidden' }),
        {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    );
    await expect(
      fetchLoaderData('m', 'default', loc, new AbortController().signal).first
    ).rejects.toThrow('Forbidden');
  });

  it('falls back to a deny-aware label when the envelope lacks a message', async () => {
    // Defense in depth: deny() now defaults the message at construction time,
    // but a hand-rolled envelope (custom server middleware) could still ship
    // without one. The client should still surface the deny intent rather
    // than the generic "Loader failed with status N".
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ __outcome: 'deny' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    await expect(
      fetchLoaderData('m', 'default', loc, new AbortController().signal).first
    ).rejects.toThrow(/Request denied \(403\)/);
  });

  it('rejects with a LoaderValidationError carrying issues when the deny envelope carries validation issues', async () => {
    const issues = [{ path: ['page'], message: 'page must be >= 1' }];
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          __outcome: 'deny',
          message: 'Invalid search parameters',
          data: { [VALIDATION_ISSUES_KEY]: issues },
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    );

    const err = await fetchLoaderData(
      'm',
      'default',
      loc,
      new AbortController().signal
    ).first.catch((e) => e);

    expect(err).toBeInstanceOf(LoaderValidationError);
    expect(err.status).toBe(400);
    expect(err.message).toBe('Invalid search parameters');
    expect(err.issues).toEqual(issues);
    // The shared reader pulls issues from the loader error too (action parity).
    expect(getValidationIssues(err)).toEqual(issues);
  });

  it('throws a plain Error (not LoaderValidationError) when the deny carries an empty issues array', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          __outcome: 'deny',
          message: 'Forbidden',
          data: { [VALIDATION_ISSUES_KEY]: [] },
        }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      )
    );

    const err = await fetchLoaderData(
      'm',
      'default',
      loc,
      new AbortController().signal
    ).first.catch((e) => e);

    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(LoaderValidationError);
    expect(getValidationIssues(err)).toBeNull();
  });

  it('throws a plain (non-validation) Error when a deny carries data without the issues key', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          __outcome: 'deny',
          message: 'Forbidden',
          data: { reason: 'nope' },
        }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      )
    );

    const err = await fetchLoaderData(
      'm',
      'default',
      loc,
      new AbortController().signal
    ).first.catch((e) => e);

    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(LoaderValidationError);
    expect(err.message).toBe('Forbidden');
    expect(getValidationIssues(err)).toBeNull();
  });

  it('falls back to the legacy { error } shape for non-deny error responses', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: 'boom' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    await expect(
      fetchLoaderData('m', 'default', loc, new AbortController().signal).first
    ).rejects.toThrow('boom');
  });

  it('uses the generic loader-failure message with remediation when the body has no error field', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({}), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    await expect(
      fetchLoaderData('m', 'default', loc, new AbortController().signal).first
    ).rejects.toThrow(
      "Loader failed with status 503. Check the loader's .server.ts for a thrown error, and the server logs for details."
    );
  });
});

describe('fetchLoaderData: streaming pump', () => {
  it('resolves first with chunk 0 and pumps later chunks to onChunk, then onEnd', async () => {
    const body =
      'event: message\ndata: "first"\n\n' +
      'event: message\ndata: "second"\n\n';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(body, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      })
    );

    const onChunk = vi.fn();
    const onEnd = vi.fn();
    const handle = fetchLoaderData<string>(
      'm',
      'default',
      loc,
      new AbortController().signal
    );
    handle.subscribe({ onChunk, onError: () => {}, onEnd });

    const first = await handle.first;
    expect(first).toBe('first');

    // Let the background pump drain the remaining events.
    await new Promise((r) => setTimeout(r, 10));
    expect(onChunk).toHaveBeenCalledTimes(1);
    expect(onChunk).toHaveBeenCalledWith('second');
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('rejects first with a specific message when the first chunk is malformed JSON', async () => {
    const body = 'event: message\ndata: {not json}\n\n';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(body, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      })
    );
    await expect(
      fetchLoaderData('m', 'default', loc, new AbortController().signal).first
    ).rejects.toThrow('Malformed first chunk in streaming loader');
  });

  it('reports a generic error via onError when a mid-stream timeout event is malformed', async () => {
    const body =
      'event: message\ndata: "first"\n\n' +
      'event: timeout\ndata: {not json}\n\n';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(body, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      })
    );

    const onError = vi.fn();
    const handle = fetchLoaderData<string>(
      'm',
      'default',
      loc,
      new AbortController().signal
    );
    handle.subscribe({ onChunk: () => {}, onError, onEnd: () => {} });

    expect(await handle.first).toBe('first');
    await new Promise((r) => setTimeout(r, 10));
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0].message).toBe(
      'Malformed timeout event in streaming loader'
    );
  });
});
