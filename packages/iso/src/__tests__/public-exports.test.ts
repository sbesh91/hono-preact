import { describe, it, expect } from 'vitest';
import * as iso from '../index.js';

describe('public exports for item 4', () => {
  it('exports Head', () => {
    expect(typeof iso.Head).toBe('function');
  });

  it('exports ClientScript', () => {
    expect(typeof iso.ClientScript).toBe('function');
  });
});

describe('view transitions toolkit exports', () => {
  it('exports module A: named elements (hooks + components)', () => {
    expect(typeof iso.useViewTransitionName).toBe('function');
    expect(typeof iso.useViewTransitionClass).toBe('function');
    expect(typeof iso.ViewTransitionName).toBe('function');
    expect(typeof iso.ViewTransitionGroup).toBe('function');
  });

  it('exports module B: lifecycle hook', () => {
    expect(typeof iso.useViewTransitionLifecycle).toBe('function');
  });

  it('exports module C: types and direction', () => {
    expect(typeof iso.useViewTransitionTypes).toBe('function');
    expect(typeof iso.subscribeViewTransitionTypes).toBe('function');
  });

  it('exports module D: persist', () => {
    expect(typeof iso.Persist).toBe('function');
    expect(typeof iso.PersistHost).toBe('function');
  });
});

describe('active-route detection exports', () => {
  it('exports useRouteMatch', () => {
    expect(typeof iso.useRouteMatch).toBe('function');
  });

  it('exports useRouteActive', () => {
    expect(typeof iso.useRouteActive).toBe('function');
  });

  it('exports NavLink', () => {
    expect(typeof iso.NavLink).toBe('function');
  });

  it('exports buildPath', () => {
    expect(typeof iso.buildPath).toBe('function');
  });
});
