import { describe, it, expect } from 'vitest';
import {
  requiredParamSlots,
  declaredParamSlots,
  isReservedParamName,
} from '../internal/param-slots.js';

describe('requiredParamSlots', () => {
  it('returns required :param names without the colon', () => {
    expect(requiredParamSlots('/board/:id')).toEqual(['id']);
    expect(requiredParamSlots('board/:boardId')).toEqual(['boardId']);
    expect(requiredParamSlots('/org/:orgId/board/:id')).toEqual([
      'orgId',
      'id',
    ]);
  });

  it('excludes optional and zero-or-more rest segments', () => {
    expect(requiredParamSlots('/a/:x?')).toEqual([]);
    expect(requiredParamSlots('/a/:rest*')).toEqual([]);
  });

  it('includes a one-or-more rest segment (`+`): both the type-level StripModifier and the runtime route matcher treat it as required', () => {
    expect(requiredParamSlots('/files/:rest+')).toEqual(['rest']);
  });

  it('returns [] for a param-less pattern', () => {
    expect(requiredParamSlots('/chat')).toEqual([]);
    expect(requiredParamSlots('/')).toEqual([]);
  });

  it("does not report a segment whose name is outside interpolatePattern's class", () => {
    // interpolatePattern and the type-level ParamFrom both constrain a param
    // name to [A-Za-z0-9_]+; a hyphenated segment like `:b-c` is not a param
    // to either of them, so it must not be a required slot here either, or a
    // bound socket/room on this pattern would be denied on every connection
    // for a "param" the client can never type or send.
    expect(requiredParamSlots('/a/:b-c')).toEqual([]);
  });
});

describe('declaredParamSlots', () => {
  it('returns every declared :param name, including optional and rest slots', () => {
    expect(declaredParamSlots('/a/:id/:x?/:rest*')).toEqual([
      'id',
      'x',
      'rest',
    ]);
  });

  it('returns required :param names without the colon', () => {
    expect(declaredParamSlots('/board/:id')).toEqual(['id']);
    expect(declaredParamSlots('board/:boardId')).toEqual(['boardId']);
    expect(declaredParamSlots('/org/:orgId/board/:id')).toEqual([
      'orgId',
      'id',
    ]);
  });

  it('includes optional and rest segments, stripped of their flag', () => {
    expect(declaredParamSlots('/a/:x?')).toEqual(['x']);
    expect(declaredParamSlots('/a/:rest*')).toEqual(['rest']);
    expect(declaredParamSlots('/a/:rest+')).toEqual(['rest']);
  });

  it('returns [] for a param-less pattern', () => {
    expect(declaredParamSlots('/chat')).toEqual([]);
    expect(declaredParamSlots('/')).toEqual([]);
  });

  it("does not report a segment whose name is outside interpolatePattern's class", () => {
    // Same alignment as requiredParamSlots: a non-conforming segment name
    // (a hyphen is outside [A-Za-z0-9_]+) is not a declared slot either, so
    // it is never restricted-into a resolved params object.
    expect(declaredParamSlots('/a/:b-c')).toEqual([]);
  });
});

describe('isReservedParamName', () => {
  it('is true for every Object.prototype own member name PARAM_SEGMENT would otherwise admit', () => {
    expect(isReservedParamName('constructor')).toBe(true);
    expect(isReservedParamName('toString')).toBe(true);
    expect(isReservedParamName('valueOf')).toBe(true);
    expect(isReservedParamName('hasOwnProperty')).toBe(true);
    expect(isReservedParamName('isPrototypeOf')).toBe(true);
    expect(isReservedParamName('propertyIsEnumerable')).toBe(true);
    expect(isReservedParamName('toLocaleString')).toBe(true);
    expect(isReservedParamName('toJSON')).toBe(true);
  });

  it('is true for the two prototype-chain-meaningful names that are not ordinary own members', () => {
    expect(isReservedParamName('__proto__')).toBe(true);
    expect(isReservedParamName('prototype')).toBe(true);
  });

  it('is false for ordinary param names', () => {
    expect(isReservedParamName('id')).toBe(false);
    expect(isReservedParamName('projectId')).toBe(false);
    expect(isReservedParamName('userId')).toBe(false);
    expect(isReservedParamName('rest')).toBe(false);
    expect(isReservedParamName('data')).toBe(false);
  });
});
