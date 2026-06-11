import { describe, expect, it } from 'vitest';
import {
  decodeActionResponse,
  RENDER_PAGE_SCOPE_MESSAGE,
  serializeActionOutcome,
  type ActionEnvelope,
} from '../internal/action-envelope.js';
import { deny, redirect, timeoutOutcome } from '../outcomes.js';

describe('serializeActionOutcome', () => {
  it('wraps a raw return value in __outcome=success', () => {
    const env = serializeActionOutcome({ kind: 'success', data: { id: 1 } });
    expect(env).toEqual({
      body: { __outcome: 'success', data: { id: 1 } },
      status: 200,
      headers: undefined,
    });
  });

  it('emits __outcome=redirect with HTTP 200 (client follows)', () => {
    const env = serializeActionOutcome({
      kind: 'outcome',
      outcome: redirect('/next'),
    });
    expect(env.body).toEqual({
      __outcome: 'redirect',
      to: '/next',
      status: 302,
    });
    expect(env.status).toBe(200);
  });

  it('emits __outcome=deny with the deny status and data', () => {
    const env = serializeActionOutcome({
      kind: 'outcome',
      outcome: deny(422, 'bad', { data: { fieldErrors: { x: ['nope'] } } }),
    });
    expect(env.body).toEqual({
      __outcome: 'deny',
      status: 422,
      message: 'bad',
      data: { fieldErrors: { x: ['nope'] } },
    });
    expect(env.status).toBe(422);
  });

  it('emits __outcome=deny without data field when none provided', () => {
    const env = serializeActionOutcome({
      kind: 'outcome',
      outcome: deny(403, 'no'),
    });
    expect(env.body).toEqual({ __outcome: 'deny', status: 403, message: 'no' });
    expect(env.status).toBe(403);
  });

  it('emits __outcome=timeout with HTTP 504', () => {
    const env = serializeActionOutcome({
      kind: 'outcome',
      outcome: timeoutOutcome(30000),
    });
    expect(env.body).toEqual({ __outcome: 'timeout', timeoutMs: 30000 });
    expect(env.status).toBe(504);
  });

  it('emits __outcome=error with HTTP 500 and a sanitized message in prod', () => {
    const env = serializeActionOutcome({
      kind: 'error',
      message: 'Action failed',
    });
    expect(env.body).toEqual({ __outcome: 'error', message: 'Action failed' });
    expect(env.status).toBe(500);
  });

  it('carries deny headers through to the envelope return value', () => {
    const env = serializeActionOutcome({
      kind: 'outcome',
      outcome: deny(401, 'unauth', {
        headers: { 'WWW-Authenticate': 'Bearer' },
      }),
    });
    expect(env.headers).toEqual({ 'WWW-Authenticate': 'Bearer' });
  });
});

function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('decodeActionResponse', () => {
  it('decodes success with its data', async () => {
    expect(
      await decodeActionResponse(
        jsonRes({ __outcome: 'success', data: { id: 1 } })
      )
    ).toEqual({ kind: 'success', data: { id: 1 } });
  });

  it('decodes redirect with a string `to`', async () => {
    expect(
      await decodeActionResponse(
        jsonRes({ __outcome: 'redirect', to: '/next', status: 302 })
      )
    ).toEqual({ kind: 'redirect', to: '/next' });
  });

  it('treats redirect without a string `to` as unknown', async () => {
    expect(
      await decodeActionResponse(jsonRes({ __outcome: 'redirect' }))
    ).toEqual({ kind: 'unknown', outcome: 'redirect', message: undefined });
  });

  it('decodes deny, carrying status, message, and data', async () => {
    expect(
      await decodeActionResponse(
        jsonRes(
          { __outcome: 'deny', status: 403, message: 'no', data: { x: 1 } },
          403
        )
      )
    ).toEqual({ kind: 'deny', status: 403, message: 'no', data: { x: 1 } });
  });

  it('falls back to the HTTP status and a derived message on a bare deny', async () => {
    expect(
      await decodeActionResponse(jsonRes({ __outcome: 'deny' }, 422))
    ).toEqual({
      kind: 'deny',
      status: 422,
      message: 'Request denied (422)',
      data: undefined,
    });
  });

  it('decodes error with a message fallback', async () => {
    expect(await decodeActionResponse(jsonRes({ __outcome: 'error' }))).toEqual(
      { kind: 'error', message: 'Action failed' }
    );
  });

  it('decodes timeout with a numeric timeoutMs', async () => {
    expect(
      await decodeActionResponse(
        jsonRes({ __outcome: 'timeout', timeoutMs: 5000 }, 504)
      )
    ).toEqual({ kind: 'timeout', timeoutMs: 5000 });
  });

  it('treats timeout without a numeric timeoutMs as unknown', async () => {
    expect(
      await decodeActionResponse(jsonRes({ __outcome: 'timeout' }, 504))
    ).toEqual({ kind: 'unknown', outcome: 'timeout', message: undefined });
  });

  it('returns unknown for an unrecognized outcome, carrying the env message', async () => {
    expect(
      await decodeActionResponse(
        jsonRes({ __outcome: 'whatever', message: 'm' })
      )
    ).toEqual({ kind: 'unknown', outcome: 'whatever', message: 'm' });
  });

  it('returns unknown for an envelope object without __outcome', async () => {
    expect(await decodeActionResponse(jsonRes({}))).toEqual({
      kind: 'unknown',
      outcome: undefined,
      message: undefined,
    });
  });

  it('treats a JSON array body as unknown, not malformed', async () => {
    // typeof [] === 'object' passes the envelope-object gate on purpose:
    // both pre-consolidation parsers treated arrays like an empty object.
    expect(await decodeActionResponse(jsonRes([1, 2]))).toEqual({
      kind: 'unknown',
      outcome: undefined,
      message: undefined,
    });
  });

  it('returns malformed for a non-JSON body, carrying the HTTP status', async () => {
    const res = new Response('<!doctype html><p>oops</p>', { status: 200 });
    expect(await decodeActionResponse(res)).toEqual({
      kind: 'malformed',
      httpStatus: 200,
    });
  });

  it('returns malformed for a JSON null body', async () => {
    expect(await decodeActionResponse(jsonRes(null, 500))).toEqual({
      kind: 'malformed',
      httpStatus: 500,
    });
  });

  it('returns malformed for a primitive JSON body', async () => {
    expect(await decodeActionResponse(jsonRes(5))).toEqual({
      kind: 'malformed',
      httpStatus: 200,
    });
  });
});

describe('RENDER_PAGE_SCOPE_MESSAGE', () => {
  it('is the message serializeActionOutcome emits for a render outcome', () => {
    const env = serializeActionOutcome({
      kind: 'outcome',
      outcome: {
        __outcome: 'render',
        Component: () => null,
      },
    });
    expect(env.body).toEqual({
      __outcome: 'error',
      message: RENDER_PAGE_SCOPE_MESSAGE,
    });
    expect(env.status).toBe(500);
  });
});
