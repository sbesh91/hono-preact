import { describe, expect, it } from 'vitest';
import { deny, DENY_CODE_STATUS } from '../outcomes.js';

describe('deny() with a named code', () => {
  it('infers status from a bare code string', () => {
    const out = deny('NOT_FOUND');
    expect(out).toMatchObject({
      __outcome: 'deny',
      status: 404,
      code: 'NOT_FOUND',
    });
  });

  it('keeps an explicit message alongside an inferred status', () => {
    const out = deny('FORBIDDEN', 'Members only');
    expect(out).toMatchObject({
      status: 403,
      code: 'FORBIDDEN',
      message: 'Members only',
    });
  });

  it('carries code on the object form and infers status when omitted', () => {
    const out = deny({ code: 'CONFLICT', data: { id: 1 } });
    expect(out).toMatchObject({ status: 409, code: 'CONFLICT' });
    expect(out.data).toEqual({ id: 1 });
  });

  it('lets an explicit status win over the code default', () => {
    const out = deny({ status: 410, code: 'CONFLICT' });
    expect(out.status).toBe(410);
    expect(out.code).toBe('CONFLICT');
  });

  it('leaves code undefined on the legacy numeric form', () => {
    const out = deny(403, 'nope');
    expect(out.code).toBeUndefined();
    expect(out.status).toBe(403);
  });

  it('maps every code to a status', () => {
    expect(DENY_CODE_STATUS.UNAUTHORIZED).toBe(401);
    expect(DENY_CODE_STATUS.TOO_MANY_REQUESTS).toBe(429);
    expect(DENY_CODE_STATUS.INTERNAL).toBe(500);
  });

  it('falls back to status 500 for an unrecognised code string and does not throw', () => {
    // This covers a typo or a dynamically-constructed code that is not in
    // the DenyCode vocabulary. The return must be a well-formed DenyOutcome
    // with a numeric status rather than undefined.
    const out = deny('NOT_A_CODE' as never);
    expect(out.__outcome).toBe('deny');
    expect(out.status).toBe(500);
    expect(typeof out.message).toBe('string');
  });

  it('falls back to status 500 for an unrecognised code in object form and does not throw', () => {
    const out = deny({ code: 'FORBIDEN' as never });
    expect(out.__outcome).toBe('deny');
    expect(out.status).toBe(500);
  });
});
