import { describe, it, expect } from 'vitest';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { Context } from 'hono';
import { runRequestScope, getRequestHonoContext } from '../cache.js';
import { runLoader } from '../internal/loader-runner.js';
import { defineLoader } from '../define-loader.js';
import { isOutcome } from '../outcomes.js';
import type { RouteHook } from 'preact-iso';

const loc = {
  path: '/x',
  url: 'http://localhost/x',
  searchParams: {},
  pathParams: {},
} as unknown as RouteHook;

describe('runLoader direct-fn path receives Hono Context via runRequestScope', () => {
  it('passes seeded c into LoaderCtx during SSR-style invocation', async () => {
    let observedC: unknown = null;
    const ref = defineLoader(async (ctx) => {
      observedC = ctx.c;
      return { ok: true };
    });
    const fakeC = { req: {}, header: () => {}, var: {} } as unknown as Context;

    await runRequestScope(
      () =>
        runLoader(ref, loc, 'id1', new AbortController().signal, {
          onChunk: () => {},
          onError: () => {},
          onEnd: () => {},
        }),
      { honoContext: fakeC }
    );

    expect(observedC).toBe(fakeC);
  });
});

describe('getRequestHonoContext contract', () => {
  it('returns undefined outside any runRequestScope (browser-like / no ALS path)', () => {
    expect(getRequestHonoContext()).toBeUndefined();
  });

  it('throws inside a runRequestScope that was not seeded with { honoContext }', async () => {
    await expect(
      runRequestScope(async () => {
        getRequestHonoContext();
      })
    ).rejects.toThrow(/runRequestScope is active but was not seeded/);
  });

  it('returns the seeded context when honoContext is passed to runRequestScope', async () => {
    const fakeC = { kind: 'fake' } as unknown as Context;
    const observed = await runRequestScope(
      async () => getRequestHonoContext<Context>(),
      { honoContext: fakeC }
    );
    expect(observed).toBe(fakeC);
  });
});

describe('LoaderCtx.c getter behavior', () => {
  it('does not throw when the loader never reads ctx.c (no scope, no seed)', async () => {
    const ref = defineLoader(async (_ctx) => {
      return { ok: true };
    });
    await expect(
      runLoader(ref, loc, 'id-noread', new AbortController().signal, {
        onChunk: () => {},
        onError: () => {},
        onEnd: () => {},
      })
    ).resolves.toEqual({ ok: true });
  });

  it('throws a clear error when a loader reads ctx.c outside any scope', async () => {
    const ref = defineLoader(async (ctx) => {
      return { whatever: ctx.c.req };
    });
    await expect(
      runLoader(ref, loc, 'id-readsC', new AbortController().signal, {
        onChunk: () => {},
        onError: () => {},
        onEnd: () => {},
      })
    ).rejects.toThrow(/ctx\.c is not available/);
  });
});

// A coercing schema: converts a string to a number, rejects non-numeric strings.
const numberSchema: StandardSchemaV1<unknown, number> = {
  '~standard': {
    version: 1,
    vendor: 'test',
    validate: (v) => {
      const n = Number(v as string);
      if (isNaN(n)) return { issues: [{ message: 'not a number' }] };
      return { value: n };
    },
  },
};

// A schema that always rejects.
const rejectSchema: StandardSchemaV1<unknown, never> = {
  '~standard': {
    version: 1,
    vendor: 'test',
    validate: () => ({ issues: [{ message: 'rejected' }] }),
  },
};

function runDirect<T>(
  ref: Parameters<typeof runLoader>[0],
  location: RouteHook
): Promise<T> {
  return runLoader(
    ref as Parameters<typeof runLoader>[0],
    location,
    'id-schema',
    new AbortController().signal,
    {
      onChunk: () => {},
      onError: () => {},
      onEnd: () => {},
    }
  ) as Promise<T>;
}

describe('runLoader SSR path: searchSchema coercion', () => {
  const locWithSearch = {
    path: '/x',
    url: 'http://localhost/x?page=42',
    searchParams: { page: '42' },
    pathParams: {},
  } as unknown as RouteHook;

  it('passes coerced searchParams to the loader fn', async () => {
    let receivedSearch: unknown;
    const ref = defineLoader(
      async (ctx) => {
        receivedSearch = ctx.location.searchParams;
        return { ok: true };
      },
      { searchSchema: numberSchema }
    );
    // numberSchema coerces { page: '42' } -> a number (NaN for object input;
    // use a plain string to test the coercion path with a scalar).
    // For this test use a raw string input to verify coercion of scalar values.
    const scalarLoc = {
      path: '/x',
      url: 'http://localhost/x?n=7',
      searchParams: '7',
      pathParams: {},
    } as unknown as RouteHook;
    await runDirect(ref, scalarLoc);
    expect(receivedSearch).toBe(7);
  });

  it('passes coerced searchParams object through when schema accepts an object', async () => {
    let receivedSearch: unknown;
    const passthruSchema: StandardSchemaV1<unknown, { page: number }> = {
      '~standard': {
        version: 1,
        vendor: 'test',
        validate: (v) => ({
          value: { page: Number((v as Record<string, string>).page) },
        }),
      },
    };
    const ref = defineLoader(
      async (ctx) => {
        receivedSearch = ctx.location.searchParams;
        return { ok: true };
      },
      { searchSchema: passthruSchema }
    );
    await runDirect(ref, locWithSearch);
    expect(receivedSearch).toEqual({ page: 42 });
  });

  it('throws deny(400) on invalid searchParams', async () => {
    const ref = defineLoader(async (_ctx) => ({ ok: true }), {
      searchSchema: rejectSchema,
    });
    const err = await runDirect(ref, locWithSearch).catch((e) => e);
    expect(isOutcome(err)).toBe(true);
    expect((err as { __outcome: string; status: number }).__outcome).toBe(
      'deny'
    );
    expect((err as { __outcome: string; status: number }).status).toBe(400);
  });
});

describe('runLoader SSR path: paramsSchema coercion', () => {
  const locWithParams = {
    path: '/x/99',
    url: 'http://localhost/x/99',
    searchParams: {},
    pathParams: { id: '99' },
  } as unknown as RouteHook;

  it('passes coerced pathParams to the loader fn', async () => {
    let receivedParams: unknown;
    const idSchema: StandardSchemaV1<unknown, { id: number }> = {
      '~standard': {
        version: 1,
        vendor: 'test',
        validate: (v) => ({
          value: { id: Number((v as Record<string, string>).id) },
        }),
      },
    };
    const ref = defineLoader(
      async (ctx) => {
        receivedParams = ctx.location.pathParams;
        return { ok: true };
      },
      { paramsSchema: idSchema }
    );
    await runDirect(ref, locWithParams);
    expect(receivedParams).toEqual({ id: 99 });
  });

  it('throws deny(404) on invalid pathParams', async () => {
    const ref = defineLoader(async (_ctx) => ({ ok: true }), {
      paramsSchema: rejectSchema,
    });
    const err = await runDirect(ref, locWithParams).catch((e) => e);
    expect(isOutcome(err)).toBe(true);
    expect((err as { __outcome: string; status: number }).__outcome).toBe(
      'deny'
    );
    expect((err as { __outcome: string; status: number }).status).toBe(404);
  });
});
