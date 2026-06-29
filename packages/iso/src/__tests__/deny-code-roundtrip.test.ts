import { describe, expect, it } from 'vitest';
import { deny } from '../outcomes.js';
import {
  serializeActionOutcome,
  decodeActionResponse,
} from '../internal/action-envelope.js';

describe('deny code survives the action envelope round-trip', () => {
  it('serializes code into the envelope body', () => {
    const env = serializeActionOutcome({
      kind: 'outcome',
      outcome: deny('FORBIDDEN', 'Members only'),
    });
    expect(env.body).toMatchObject({
      __outcome: 'deny',
      status: 403,
      message: 'Members only',
      code: 'FORBIDDEN',
    });
  });

  it('decodes code back off the wire', async () => {
    const env = serializeActionOutcome({
      kind: 'outcome',
      outcome: deny('CONFLICT', 'dupe', { data: { id: 1 } }),
    });
    const res = new Response(JSON.stringify(env.body), {
      status: env.status,
      headers: { 'Content-Type': 'application/json' },
    });
    const decoded = await decodeActionResponse(res);
    expect(decoded).toMatchObject({ kind: 'deny', status: 409, code: 'CONFLICT' });
  });

  it('leaves code undefined for a legacy numeric deny', async () => {
    const env = serializeActionOutcome({
      kind: 'outcome',
      outcome: deny(403, 'nope'),
    });
    const res = new Response(JSON.stringify(env.body), {
      status: env.status,
      headers: { 'Content-Type': 'application/json' },
    });
    const decoded = await decodeActionResponse(res);
    expect(decoded).toMatchObject({ kind: 'deny' });
    expect((decoded as { code?: string }).code).toBeUndefined();
  });
});

import { applyDecodedOutcome } from '../internal/decoded-outcome.js';

describe('deny code reaches the OutcomeSink', () => {
  it('passes code to sink.deny', () => {
    let seen: string | undefined = 'unset';
    applyDecodedOutcome(
      { kind: 'deny', status: 403, message: 'no', code: 'FORBIDDEN' },
      {
        success: () => {},
        navigated: () => {},
        crossOriginRedirect: () => {},
        deny: (_s, _m, _d, code) => {
          seen = code;
        },
        error: () => {},
        timeout: () => {},
        unknown: () => {},
        malformed: () => {},
      }
    );
    expect(seen).toBe('FORBIDDEN');
  });
});
