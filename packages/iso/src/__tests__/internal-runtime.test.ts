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
      // The own-property presence check shared with @hono-preact/server's
      // room-key resolver and route-bound socket param parse, so both agree
      // on "present" (`Object.hasOwn AND non-empty`, never a bare index read
      // that could resolve an inherited member).
      'isPresentParamSlot',
      // The hazardous-colon-segment predicate shared with
      // @hono-preact/server's boot binding guard's route-id conformance
      // check, so it and defineChannel's own definition-time check can
      // never disagree on which ':'-segment spellings are a real hazard.
      'isHazardousColonSegment',
      // The reserved-param-name predicate: true for any name that would
      // resolve through Object.prototype (or __proto__/prototype). Shared
      // by defineRoutes's route-tree validator and
      // defineChannel/defineRoom's definition-time checks so a route or
      // channel can never DECLARE a param named after a prototype member,
      // closing the prototype-chain param-read hazard on every guard tier
      // structurally.
      'isReservedParamName',
      // The reserved-name scan over a slash-joined pattern's segments, shared
      // by defineRoutes's route-tree validator and serverRoute's binder so a
      // route-bound loader/action/socket/room is rejected on the same rule.
      'reservedParamNamesIn',
    ]);
    const actual = new Set(Object.keys(runtime));
    expect([...actual].sort()).toEqual([...expected].sort());
  });
});
