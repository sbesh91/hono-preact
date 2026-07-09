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
});

describe('realtime channel exports', () => {
  it('exports defineChannel and publish', () => {
    expect(typeof iso.defineChannel).toBe('function');
    expect(typeof iso.publish).toBe('function');
  });

  it('exports eventStream', () => {
    expect(typeof iso.eventStream).toBe('function');
  });
});

describe('duplex WebSocket exports', () => {
  it('exports defineSocket', () => {
    expect(typeof iso.defineSocket).toBe('function');
  });

  it('exports useSocket', () => {
    expect(typeof iso.useSocket).toBe('function');
  });

  it('exports upgradeWebSocket', () => {
    expect(typeof iso.upgradeWebSocket).toBe('function');
  });
});

describe('rooms and presence exports', () => {
  it('exports defineRoom', () => {
    expect(typeof iso.defineRoom).toBe('function');
  });

  it('exports useRoom', () => {
    expect(typeof iso.useRoom).toBe('function');
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

describe('head management exports', () => {
  it('re-exports the hoofd head hooks', () => {
    expect(typeof iso.useTitle).toBe('function');
    expect(typeof iso.useTitleTemplate).toBe('function');
    expect(typeof iso.useMeta).toBe('function');
    expect(typeof iso.useLink).toBe('function');
    expect(typeof iso.useLang).toBe('function');
    expect(typeof iso.useScript).toBe('function');
  });
});
