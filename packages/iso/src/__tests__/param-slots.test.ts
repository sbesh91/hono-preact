import { describe, it, expect } from 'vitest';
import { requiredParamSlots } from '../internal/param-slots.js';

describe('requiredParamSlots', () => {
  it('returns required :param names without the colon', () => {
    expect(requiredParamSlots('/board/:id')).toEqual(['id']);
    expect(requiredParamSlots('board/:boardId')).toEqual(['boardId']);
    expect(requiredParamSlots('/org/:orgId/board/:id')).toEqual(['orgId', 'id']);
  });

  it('excludes optional and rest segments', () => {
    expect(requiredParamSlots('/a/:x?')).toEqual([]);
    expect(requiredParamSlots('/a/:rest*')).toEqual([]);
    expect(requiredParamSlots('/a/:rest+')).toEqual([]);
  });

  it('returns [] for a param-less pattern', () => {
    expect(requiredParamSlots('/chat')).toEqual([]);
    expect(requiredParamSlots('/')).toEqual([]);
  });
});
