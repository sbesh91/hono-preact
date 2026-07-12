import { describe, it, expect } from 'vitest';
import {
  requiredParamSlots,
  declaredParamSlots,
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
});
