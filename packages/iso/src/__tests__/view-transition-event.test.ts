import { describe, it, expect } from 'vitest';
import {
  ViewTransitionEvent,
  type NavDirection,
} from '../internal/view-transition-event.js';

describe('ViewTransitionEvent', () => {
  it('exposes to/from/direction passed at construction', () => {
    const event = new ViewTransitionEvent({
      to: '/posts',
      from: '/',
      direction: 'push',
    });
    expect(event.to).toBe('/posts');
    expect(event.from).toBe('/');
    expect(event.direction).toBe('push');
  });

  it('starts with an empty mutable types array', () => {
    const event = new ViewTransitionEvent({
      to: '/a',
      from: undefined,
      direction: 'initial',
    });
    expect(event.types).toEqual([]);
    event.types.push('foo');
    expect(event.types).toEqual(['foo']);
  });

  it('starts with transition === null', () => {
    const event = new ViewTransitionEvent({
      to: '/a',
      from: undefined,
      direction: 'initial',
    });
    expect(event.transition).toBeNull();
  });

  it('skip() flips an internal flag readable by the dispatcher', () => {
    const event = new ViewTransitionEvent({
      to: '/a',
      from: undefined,
      direction: 'initial',
    });
    expect(event._skipped).toBe(false);
    event.skip();
    expect(event._skipped).toBe(true);
  });

  it('set/get round-trips arbitrary keys', () => {
    const event = new ViewTransitionEvent({
      to: '/a',
      from: undefined,
      direction: 'initial',
    });
    const SYM = Symbol('test');
    event.set(SYM, { scrollY: 42 });
    event.set('s', 'hi');
    expect(event.get(SYM)).toEqual({ scrollY: 42 });
    expect(event.get('s')).toBe('hi');
    expect(event.get('missing')).toBeUndefined();
  });
});

const _typeCheck: NavDirection[] = [
  'initial',
  'push',
  'replace',
  'back',
  'forward',
];
