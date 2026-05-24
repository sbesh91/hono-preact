import { describe, expect, it } from 'vitest';
import {
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
    const env = serializeActionOutcome({ kind: 'outcome', outcome: redirect('/next') });
    expect(env.body).toEqual({ __outcome: 'redirect', to: '/next', status: 302 });
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
    const env = serializeActionOutcome({ kind: 'outcome', outcome: deny(403, 'no') });
    expect(env.body).toEqual({ __outcome: 'deny', status: 403, message: 'no' });
    expect(env.status).toBe(403);
  });

  it('emits __outcome=timeout with HTTP 504', () => {
    const env = serializeActionOutcome({ kind: 'outcome', outcome: timeoutOutcome(30000) });
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
      outcome: deny(401, 'unauth', { headers: { 'WWW-Authenticate': 'Bearer' } }),
    });
    expect(env.headers).toEqual({ 'WWW-Authenticate': 'Bearer' });
  });
});
