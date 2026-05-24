import { describe, it, expect } from 'vitest';
import {
  redirect,
  deny,
  isOutcome,
  isRedirect,
  isDeny,
  isRender,
} from '../outcomes.js';

describe('redirect()', () => {
  it('accepts a string and produces a 302 outcome', () => {
    const o = redirect('/login');
    expect(o).toEqual({
      __outcome: 'redirect',
      to: '/login',
      status: 302,
      headers: undefined,
    });
  });

  it('accepts an object with status and headers', () => {
    const o = redirect({
      to: '/login',
      status: 307,
      headers: { 'X-Reason': 'auth' },
    });
    expect(o.status).toBe(307);
    expect(o.headers).toEqual({ 'X-Reason': 'auth' });
  });
});

describe('deny()', () => {
  it('accepts a positional status and message', () => {
    const o = deny(403, 'Forbidden');
    expect(o).toEqual({
      __outcome: 'deny',
      status: 403,
      message: 'Forbidden',
      headers: undefined,
    });
  });

  it('accepts an object form with headers', () => {
    const o = deny({
      status: 429,
      message: 'Slow',
      headers: { 'Retry-After': '5' },
    });
    expect(o.status).toBe(429);
    expect(o.headers).toEqual({ 'Retry-After': '5' });
  });

  it('defaults the message when none is provided (positional form)', () => {
    const o = deny(401);
    // `JSON.stringify` drops `undefined`, so the constructor defaults the
    // message to a status-aware string to guarantee the wire envelope always
    // carries something the client can surface as Error.message.
    expect(o.message).toBe('Request denied (401)');
  });

  it('defaults the message when none is provided (object form)', () => {
    const o = deny({ status: 403 });
    expect(o.message).toBe('Request denied (403)');
  });

  it('carries opts.data through unchanged on the (status, message, opts) form', () => {
    const fieldErrors = { email: ['required'], name: ['too short'] };
    const outcome = deny(422, 'Validation failed', { data: { fieldErrors } });
    expect(outcome.__outcome).toBe('deny');
    expect(outcome.status).toBe(422);
    expect(outcome.message).toBe('Validation failed');
    expect(outcome.data).toEqual({ fieldErrors });
  });

  it('carries opts.data on the (DenyInput) form too', () => {
    const outcome = deny({
      status: 403,
      message: 'no',
      data: { reason: 'role' },
    });
    expect(outcome.data).toEqual({ reason: 'role' });
  });

  it('omits data when not provided (back-compat)', () => {
    const outcome = deny(403, 'nope');
    expect(outcome).not.toHaveProperty('data');
  });

  it('exposes opts.headers on the (status, message, opts) form', () => {
    const outcome = deny(401, 'unauth', {
      headers: { 'WWW-Authenticate': 'Bearer' },
    });
    expect(outcome.headers).toEqual({ 'WWW-Authenticate': 'Bearer' });
  });
});

describe('predicates', () => {
  it('isOutcome matches redirect/deny/render shapes', () => {
    expect(isOutcome(redirect('/x'))).toBe(true);
    expect(isOutcome(deny(403))).toBe(true);
    expect(isOutcome({})).toBe(false);
    expect(isOutcome(null)).toBe(false);
    expect(isOutcome(new Error('x'))).toBe(false);
  });

  it('isOutcome rejects objects with an unknown __outcome tag', () => {
    expect(isOutcome({ __outcome: 'unknown_variant' })).toBe(false);
    expect(isOutcome({ __outcome: undefined })).toBe(false);
  });

  it('isRedirect / isDeny / isRender discriminate the variants', () => {
    expect(isRedirect(redirect('/x'))).toBe(true);
    expect(isRedirect(deny(403))).toBe(false);
    expect(isDeny(deny(403))).toBe(true);
    expect(isDeny(redirect('/x'))).toBe(false);
    expect(isRender({ __outcome: 'render', Component: () => null })).toBe(true);
  });
});
