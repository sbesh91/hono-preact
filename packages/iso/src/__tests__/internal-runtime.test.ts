import { describe, expect, it } from 'vitest';
import * as runtime from '../internal-runtime.js';
import * as contract from '../internal/contract.js';

const PLUMBING = [
  'installHistoryShim',
  'installNavTransitionScheduler',
  'installPubSubBackend',
  'getPubSubBackend',
  '__resetPubSubForTesting',
  'joinPresence',
  'leavePresence',
  'updatePresence',
  'presenceMembers',
  '__resetPresenceForTesting',
  'installStreamRegistry',
  'installWebSocketUpgrader',
  'getWebSocketUpgrader',
  '__resetWebSocketUpgraderForTesting',
  'installRealtimeConnector',
  'getRealtimeConnector',
  '__resetRealtimeConnectorForTesting',
  '__$createLoaderStub_hpiso',
] as const;

describe('iso /internal/runtime door', () => {
  it('exposes the framework-emitted plumbing as functions', () => {
    for (const name of PLUMBING) {
      expect(typeof (runtime as Record<string, unknown>)[name]).toBe(
        'function'
      );
    }
  });

  it('re-exports the entire wire-contract constants module', () => {
    for (const key of Object.keys(contract)) {
      expect((runtime as Record<string, unknown>)[key]).toBe(
        (contract as Record<string, unknown>)[key]
      );
    }
  });

  it('exposes the mutable env runtime-mode flag', () => {
    const { env } = runtime;
    expect(typeof env).toBe('object');
    expect(env).toHaveProperty('current');
  });

  it('exports exactly the plumbing set plus the contract module (no drift)', () => {
    const expected = new Set<string>([
      ...PLUMBING,
      'env',
      ...Object.keys(contract),
      'validateWithSchema',
      'normalizeIssues',
      'mapIssuesToFields',
      'coerceActionInput',
      'coerceLoaderLocation',
      'collectFormData',
      // Subtree-pattern key construction shared with @hono-preact/server's
      // boot validator; moved off the public barrel (users spell the pattern
      // as a literal '<path>/*' string).
      'subtreePatternOf',
      // Required-param-slot extraction shared with @hono-preact/server's
      // room-key resolver, socket param resolver, and boot route/channel
      // congruence check, so the three agree on what "required" means.
      'requiredParamSlots',
      // Declared-param-slot extraction (required AND optional/rest) shared
      // with the same two resolvers, so they can restrict a resolved params
      // object to the pattern's own declared slots and drop anything else.
      'declaredParamSlots',
      // The WIDE param-slot extraction (mirrors preact-iso's own `exec`
      // matcher, hyphens and all) shared with @hono-preact/server's
      // colocated-unit advisory and its room/channel congruence check, so
      // neither is blind to a param name declaredParamSlots doesn't
      // recognize.
      'guardReadableParamSlots',
      // The conforming-':param' predicate shared with @hono-preact/server's
      // boot binding guard, which rejects a route-bound socket/room whose
      // __routeId carries a non-conforming ':'-segment.
      'isConformingParamSegment',
      // Prototype-less params-record builder and own-property presence
      // check shared with @hono-preact/server's room-key resolver and
      // socket param resolver, so both close the prototype-chain auth
      // bypass (a required slot named e.g. 'constructor' or 'toString')
      // identically.
      'toNullProtoParams',
      'isPresentParamSlot',
      // A fresh, prototype-less, MUTABLE EMPTY params record builder for
      // every "no params to resolve" call site (a colocated socket,
      // resolveGuardDenied's default, a failed room-key resolution, a denied
      // socket's resolved params): the completion of the prototype-chain fix
      // for sites that previously fell back to a plain `{}` literal instead
      // of running the parsed-params pipeline. Returns a fresh object per
      // call (not a shared singleton) so a userland-mutable position (the
      // socket `data` edge factory's params argument) stays extensible.
      'emptyParams',
      // The hazardous-colon-segment predicate shared with
      // @hono-preact/server's boot binding guard's route-id conformance
      // check, so it and defineChannel's own definition-time check can
      // never disagree on which ':'-segment spellings are a real hazard.
      'isHazardousColonSegment',
    ]);
    const actual = new Set(Object.keys(runtime));
    expect([...actual].sort()).toEqual([...expected].sort());
  });
});
