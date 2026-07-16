import { describe, it, expect } from 'vitest';
import { parseKeyParams } from '../param-parse.js';

// The route-bound socket branch of `resolveConnection` and `resolveRoomKey`
// both run this shared pipeline directly.
describe('parseKeyParams', () => {
  const enc = (o: unknown) => JSON.stringify(o);

  it('accepts a wire covering every required slot', () => {
    expect(parseKeyParams('/board/:id', enc({ id: 'b1' }))).toEqual({
      ok: true,
      params: { id: 'b1' },
    });
  });

  it('requires nothing for a param-less pattern', () => {
    expect(parseKeyParams('/chat', undefined)).toEqual({
      ok: true,
      params: {},
    });
  });

  it('reports the missing slot when a well-formed wire omits it', () => {
    expect(parseKeyParams('/board/:id', undefined)).toEqual({
      ok: false,
      reason: 'missing-params',
      missing: ['id'],
    });
    expect(parseKeyParams('/board/:id', enc({}))).toEqual({
      ok: false,
      reason: 'missing-params',
      missing: ['id'],
    });
  });

  it('rejects a non-string value as an unusable payload, not a missing param', () => {
    // The slot WAS sent, so calling it "missing" would send the author hunting
    // for the wrong bug. The payload itself is the contract lie.
    expect(parseKeyParams('/board/:id', enc({ id: 42 }))).toEqual({
      ok: false,
      reason: 'invalid-payload',
    });
  });

  it('rejects malformed JSON / non-object wire as an unusable payload', () => {
    expect(parseKeyParams('/board/:id', 'not-json')).toEqual({
      ok: false,
      reason: 'invalid-payload',
    });
    expect(parseKeyParams('/board/:id', enc([1, 2]))).toEqual({
      ok: false,
      reason: 'invalid-payload',
    });
  });

  it('rejects an empty-string value (treats the slot as missing)', () => {
    // Pinned: `isPresentParamSlot` is `Object.hasOwn AND non-empty`, so an
    // empty string denies. A future refactor to `slot in params` (or dropping
    // the non-empty half) would ALLOW an empty id through, an auth regression.
    // The payload is well formed (a string value), so this is missing-params,
    // not invalid-payload.
    expect(parseKeyParams('/board/:id', enc({ id: '' }))).toEqual({
      ok: false,
      reason: 'missing-params',
      missing: ['id'],
    });
  });

  it('does not require an optional slot', () => {
    expect(parseKeyParams('/a/:x?', undefined)).toEqual({
      ok: true,
      params: {},
    });
  });

  it('rejects a non-string value on an OPTIONAL slot (mirrors resolveRoomKey: denies the whole payload)', () => {
    // The slot is optional, so omitting it would be fine, but a NON-STRING
    // value is a contract lie anywhere on the wire object. parseKeyParams
    // matches resolveRoomKey's stricter policy and denies the whole payload
    // rather than silently dropping the entry and connecting.
    //
    // This is also why the failure carries a reason: there is no missing slot
    // to name here (the pattern requires none), so reporting this as
    // `missing: []` would render a dev warning with an empty param list.
    expect(parseKeyParams('/a/:x?', enc({ x: 42 }))).toEqual({
      ok: false,
      reason: 'invalid-payload',
    });
  });

  it('(security) drops a wire key that is not a declared slot on the pattern', () => {
    // A client for `/board/:id` sends an extra `orgId`, a key no real HTTP
    // request could ever produce (Hono only populates declared slots). The
    // resolver must restrict the result to the pattern's declared slots.
    expect(
      parseKeyParams('/board/:id', enc({ id: 'b1', orgId: 'victim' }))
    ).toEqual({
      ok: true,
      params: { id: 'b1' },
    });
  });

  it('drops an UNDECLARED non-string extra rather than rejecting the whole payload', () => {
    // The declared-slot restriction runs BEFORE the non-string check, so an
    // incidental non-string extra under an undeclared key (e.g. a stray
    // `count: 3` carried in from a wider record the caller passed) is dropped,
    // not treated as a contract violation. Only a non-string value under a
    // DECLARED slot is an invalid-payload deny.
    expect(parseKeyParams('/board/:id', enc({ id: 'b1', count: 3 }))).toEqual({
      ok: true,
      params: { id: 'b1' },
    });
  });

  it('keeps a legitimately-supplied optional slot (declared, not required)', () => {
    // Filtering must use the DECLARED slot set, not the required one: an
    // optional slot is a legitimate declared slot and must survive.
    expect(parseKeyParams('/a/:x?', enc({ x: 'v' }))).toEqual({
      ok: true,
      params: { x: 'v' },
    });
  });

  it('does not require a zero-or-more rest slot and keeps its value through the declared-slot filter', () => {
    // `:rest*` (zero-or-more) is declared but never required
    // (requiredParamSlots excludes the `*` flag), so a wire with no rest
    // value still resolves ok, and a wire that DOES supply one is not dropped
    // by the declared-slot filter (declaredParamSlots includes it).
    expect(parseKeyParams('/files/:rest*', undefined)).toEqual({
      ok: true,
      params: {},
    });
    expect(parseKeyParams('/files/:rest*', enc({ rest: 'a/b' }))).toEqual({
      ok: true,
      params: { rest: 'a/b' },
    });
  });

  // ---------------------------------------------------------------------
  // (security) prototype-chain read safety at the parse level. The primary
  // closure is structural: no route or channel can DECLARE a param named
  // after an `Object.prototype` member (`isReservedParamName`), so patterns
  // like these cannot exist for a real route. But `parseKeyParams` is a pure
  // function that must stay safe regardless, and it is: the presence check is
  // `isPresentParamSlot` (`Object.hasOwn`, never a bare `!params[slot]`), so
  // an ABSENT required slot named e.g. `constructor` reports as MISSING on an
  // ordinary object rather than resolving the inherited (truthy) member and
  // wrongly passing with `missing: []`.
  // ---------------------------------------------------------------------

  it('(security) reports :constructor as missing when the client sends no params (own-property presence check)', () => {
    expect(parseKeyParams('/plugin/:constructor', enc({}))).toEqual({
      ok: false,
      reason: 'missing-params',
      missing: ['constructor'],
    });
  });

  it('(security) denies a route bound to :toString when the client sends no params', () => {
    expect(parseKeyParams('/plugin/:toString', enc({}))).toEqual({
      ok: false,
      reason: 'missing-params',
      missing: ['toString'],
    });
  });

  it('(security) denies a route bound to :hasOwnProperty when the client sends no params', () => {
    expect(parseKeyParams('/plugin/:hasOwnProperty', enc({}))).toEqual({
      ok: false,
      reason: 'missing-params',
      missing: ['hasOwnProperty'],
    });
  });

  it('(security) denies a route bound to :valueOf when the client sends no params', () => {
    expect(parseKeyParams('/plugin/:valueOf', enc({}))).toEqual({
      ok: false,
      reason: 'missing-params',
      missing: ['valueOf'],
    });
  });

  it('(security) a legitimately-supplied :constructor value still works', () => {
    // The prototype-chain fix must not break a real, deliberately-named
    // `:constructor` slot: a genuine own-property value still resolves ok.
    expect(
      parseKeyParams('/plugin/:constructor', enc({ constructor: 'x' }))
    ).toEqual({
      ok: true,
      params: { constructor: 'x' },
    });
  });

  it('requires a one-or-more (`+`) rest slot: RouteParams types it required and the runtime route matcher refuses to match it empty', () => {
    // A hand-rolled client that omits `rest` must be denied, not connected
    // with `params: {}`: `+` is required both at the type level
    // (StripModifier maps `+` to `{ optional: false }`) and at the runtime
    // route matcher (preact-iso's `exec` refuses to match a `+` segment with
    // no value).
    expect(parseKeyParams('/files/:rest+', undefined)).toEqual({
      ok: false,
      reason: 'missing-params',
      missing: ['rest'],
    });
    expect(parseKeyParams('/files/:rest+', enc({ rest: 'a/b' }))).toEqual({
      ok: true,
      params: { rest: 'a/b' },
    });
  });
});
