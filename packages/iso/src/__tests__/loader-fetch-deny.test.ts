import { describe, it, expect, afterEach, vi } from 'vitest';
import { fetchLoaderData } from '../internal/loader-fetch.js';
import { LoaderDenyError } from '../loader-deny-error.js';
import { LoaderValidationError } from '../loader-validation-error.js';
import { VALIDATION_ISSUES_KEY } from '../internal/contract.js';

const loc = { path: '/movies', pathParams: {}, searchParams: {} };

function respondWith(status: number, body: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(JSON.stringify(body), {
          status,
          headers: { 'Content-Type': 'application/json' },
        })
    )
  );
}

function load(): Promise<unknown> {
  return fetchLoaderData<unknown>(
    'pages/movies',
    'default',
    loc,
    new AbortController().signal
  ).first;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('loader deny decoding', () => {
  it('surfaces a deny envelope as a LoaderDenyError carrying status, code and data', async () => {
    respondWith(403, {
      __outcome: 'deny',
      message: 'no',
      code: 'FORBIDDEN',
      data: { a: 1 },
    });
    const err = await load().then(
      () => null,
      (e: unknown) => e
    );
    expect(err).toBeInstanceOf(LoaderDenyError);
    expect(err).toMatchObject({
      name: 'LoaderDenyError',
      message: 'no',
      status: 403,
      code: 'FORBIDDEN',
      data: { a: 1 },
    });
  });

  it('leaves code undefined when the envelope omits it, and when it is not a known DenyCode', async () => {
    respondWith(403, { __outcome: 'deny', message: 'no' });
    const bare = await load().then(
      () => null,
      (e: unknown) => e
    );
    expect(bare).toBeInstanceOf(LoaderDenyError);
    expect((bare as LoaderDenyError).code).toBeUndefined();

    respondWith(403, { __outcome: 'deny', message: 'no', code: 'NOPE' });
    const bogus = await load().then(
      () => null,
      (e: unknown) => e
    );
    expect((bogus as LoaderDenyError).code).toBeUndefined();
  });

  it('still raises LoaderValidationError for a deny carrying validation issues (regression)', async () => {
    respondWith(400, {
      __outcome: 'deny',
      message: 'Validation failed',
      code: 'BAD_REQUEST',
      data: {
        [VALIDATION_ISSUES_KEY]: [{ path: ['id'], message: 'required' }],
      },
    });
    const err = await load().then(
      () => null,
      (e: unknown) => e
    );
    expect(err).toBeInstanceOf(LoaderValidationError);
    expect((err as LoaderValidationError).issues).toEqual([
      { path: ['id'], message: 'required' },
    ]);
  });

  it('defaults the message when the envelope ships without one', async () => {
    respondWith(403, { __outcome: 'deny' });
    const err = await load().then(
      () => null,
      (e: unknown) => e
    );
    expect((err as LoaderDenyError).message).toBe('Request denied (403)');
  });
});
