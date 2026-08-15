// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/preact';
import { LocationProvider } from 'preact-iso';
import { NavLink } from '../nav-link.js';
import type { AnyLoaderRef } from '../define-loader.js';

// Records the href it was constructed with each time the returned callback
// fires, so a test can tell which target a given prefetch call was for.
const prefetchSpy = vi.fn();
// Records the ARGUMENTS the hook itself was constructed with, so a test can
// assert the caller's loader refs actually reach `usePrefetch` rather than
// only that some prefetch happened.
const usePrefetchSpy = vi.fn();
vi.mock('../use-prefetch.js', () => ({
  usePrefetch: (href: string, refs: unknown) => {
    usePrefetchSpy(href, refs);
    return () => prefetchSpy(href);
  },
}));

const ref = { __id: Symbol('r') } as unknown as AnyLoaderRef;
const ref2 = { __id: Symbol('r2') } as unknown as AnyLoaderRef;

// A controllable IntersectionObserver: each construction is recorded so a test
// can drive the callback and assert on observe/disconnect.
type FakeIO = {
  callback: IntersectionObserverCallback;
  observed: Element[];
  disconnected: number;
  trigger: (isIntersecting: boolean) => void;
};
let observers: FakeIO[] = [];

class TestIntersectionObserver {
  constructor(cb: IntersectionObserverCallback) {
    const self: FakeIO = {
      callback: cb,
      observed: [],
      disconnected: 0,
      trigger: (isIntersecting: boolean) => {
        cb(
          [{ isIntersecting } as unknown as IntersectionObserverEntry],
          this as unknown as IntersectionObserver
        );
      },
    };
    this.state = self;
    observers.push(self);
  }
  state: FakeIO;
  observe(el: Element) {
    this.state.observed.push(el);
  }
  unobserve() {}
  disconnect() {
    this.state.disconnected += 1;
  }
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

describe('NavLink prefetch', () => {
  beforeEach(() => {
    prefetchSpy.mockClear();
    usePrefetchSpy.mockClear();
    observers = [];
    vi.stubGlobal('IntersectionObserver', TestIntersectionObserver);
    vi.useFakeTimers();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('does not prefetch when the prop is absent', () => {
    const { getByText } = render(
      <LocationProvider>
        <NavLink href="/a">A</NavLink>
      </LocationProvider>
    );
    fireEvent.pointerEnter(getByText('A'));
    vi.advanceTimersByTime(500);
    expect(prefetchSpy).not.toHaveBeenCalled();
  });

  it('hover fires once after the intent delay', () => {
    const { getByText } = render(
      <LocationProvider>
        <NavLink href="/a" prefetch="hover" prefetchLoaders={ref}>
          A
        </NavLink>
      </LocationProvider>
    );
    fireEvent.pointerEnter(getByText('A'));
    expect(prefetchSpy).not.toHaveBeenCalled(); // debounced, not immediate
    vi.advanceTimersByTime(150);
    expect(prefetchSpy).toHaveBeenCalledTimes(1);
  });

  it('leaving before the delay cancels the prefetch', () => {
    const { getByText } = render(
      <LocationProvider>
        <NavLink href="/a" prefetch="hover" prefetchLoaders={ref}>
          A
        </NavLink>
      </LocationProvider>
    );
    const a = getByText('A');
    fireEvent.pointerEnter(a);
    vi.advanceTimersByTime(50);
    fireEvent.pointerLeave(a);
    vi.advanceTimersByTime(500);
    expect(prefetchSpy).not.toHaveBeenCalled();
  });

  it('focus prefetches immediately for keyboard users', () => {
    const { getByText } = render(
      <LocationProvider>
        <NavLink href="/a" prefetch="hover" prefetchLoaders={ref}>
          A
        </NavLink>
      </LocationProvider>
    );
    fireEvent.focus(getByText('A'));
    expect(prefetchSpy).toHaveBeenCalledTimes(1);
  });

  it('prefetch={false} disables it', () => {
    const { getByText } = render(
      <LocationProvider>
        <NavLink href="/a" prefetch={false} prefetchLoaders={ref}>
          A
        </NavLink>
      </LocationProvider>
    );
    fireEvent.pointerEnter(getByText('A'));
    vi.advanceTimersByTime(500);
    expect(prefetchSpy).not.toHaveBeenCalled();
  });

  it('does not leak the new props onto the anchor element', () => {
    const { getByText } = render(
      <LocationProvider>
        <NavLink href="/a" prefetch="hover" prefetchLoaders={ref}>
          A
        </NavLink>
      </LocationProvider>
    );
    const a = getByText('A') as HTMLAnchorElement;
    expect(a.getAttribute('prefetch')).toBeNull();
    expect(a.getAttribute('prefetchLoaders')).toBeNull();
  });

  it('fire-once still holds when hovering the same href repeatedly', () => {
    const { getByText } = render(
      <LocationProvider>
        <NavLink href="/a" prefetch="hover" prefetchLoaders={ref}>
          A
        </NavLink>
      </LocationProvider>
    );
    const a = getByText('A');
    fireEvent.pointerEnter(a);
    vi.advanceTimersByTime(150);
    expect(prefetchSpy).toHaveBeenCalledTimes(1);
    fireEvent.pointerLeave(a);
    fireEvent.pointerEnter(a);
    vi.advanceTimersByTime(150);
    expect(prefetchSpy).toHaveBeenCalledTimes(1);
  });

  it('a changed href on the same instance becomes prefetchable again', () => {
    const { getByText, rerender } = render(
      <LocationProvider>
        <NavLink href="/a" prefetch="hover" prefetchLoaders={ref}>
          A
        </NavLink>
      </LocationProvider>
    );
    fireEvent.focus(getByText('A'));
    expect(prefetchSpy).toHaveBeenCalledTimes(1);
    expect(prefetchSpy).toHaveBeenLastCalledWith('/a');

    // Same component position, different href: simulates a reorderable list
    // or "recently viewed" rail reusing the instance at this slot.
    rerender(
      <LocationProvider>
        <NavLink href="/b" prefetch="hover" prefetchLoaders={ref}>
          A
        </NavLink>
      </LocationProvider>
    );
    fireEvent.focus(getByText('A'));
    expect(prefetchSpy).toHaveBeenCalledTimes(2);
    expect(prefetchSpy).toHaveBeenLastCalledWith('/b');
  });

  it('preserves active-state behavior alongside prefetch', () => {
    const { getByText } = render(
      <LocationProvider>
        <NavLink
          href="/a"
          prefetch="hover"
          prefetchLoaders={ref}
          class="base"
          activeClass="on"
        >
          A
        </NavLink>
      </LocationProvider>
    );
    expect((getByText('A') as HTMLAnchorElement).className).toContain('base');
  });

  it('passes a single prefetchLoaders ref through to usePrefetch', () => {
    render(
      <LocationProvider>
        <NavLink href="/a" prefetch="hover" prefetchLoaders={ref}>
          A
        </NavLink>
      </LocationProvider>
    );
    expect(usePrefetchSpy).toHaveBeenLastCalledWith('/a', ref);
  });

  it('passes an array of prefetchLoaders refs through to usePrefetch', () => {
    const refs = [ref, ref2];
    render(
      <LocationProvider>
        <NavLink href="/a" prefetch="hover" prefetchLoaders={refs}>
          A
        </NavLink>
      </LocationProvider>
    );
    expect(usePrefetchSpy).toHaveBeenLastCalledWith('/a', refs);
  });

  it('visible prefetches once the link intersects the viewport', () => {
    render(
      <LocationProvider>
        <NavLink href="/a" prefetch="visible" prefetchLoaders={ref}>
          A
        </NavLink>
      </LocationProvider>
    );
    expect(observers).toHaveLength(1);
    expect(prefetchSpy).not.toHaveBeenCalled();
    observers[0].trigger(true);
    expect(prefetchSpy).toHaveBeenCalledTimes(1);
    expect(prefetchSpy).toHaveBeenLastCalledWith('/a');
  });

  it('visible does not prefetch while the link is off screen', () => {
    render(
      <LocationProvider>
        <NavLink href="/a" prefetch="visible" prefetchLoaders={ref}>
          A
        </NavLink>
      </LocationProvider>
    );
    observers[0].trigger(false);
    observers[0].trigger(false);
    expect(prefetchSpy).not.toHaveBeenCalled();
    expect(observers[0].disconnected).toBe(0);
  });

  it('visible disconnects the observer after firing', () => {
    render(
      <LocationProvider>
        <NavLink href="/a" prefetch="visible" prefetchLoaders={ref}>
          A
        </NavLink>
      </LocationProvider>
    );
    observers[0].trigger(true);
    expect(observers[0].disconnected).toBeGreaterThanOrEqual(1);
    // A second intersection after disconnect must not re-fire.
    observers[0].trigger(true);
    expect(prefetchSpy).toHaveBeenCalledTimes(1);
  });

  it('visible observes the anchor and disconnects on unmount', () => {
    const { getByText, unmount } = render(
      <LocationProvider>
        <NavLink href="/a" prefetch="visible" prefetchLoaders={ref}>
          A
        </NavLink>
      </LocationProvider>
    );
    expect(observers[0].observed).toEqual([getByText('A')]);
    expect(observers[0].disconnected).toBe(0);
    unmount();
    expect(observers[0].disconnected).toBeGreaterThanOrEqual(1);
  });

  it('an href change mid-debounce leaves the new href prefetchable', () => {
    const { getByText, rerender } = render(
      <LocationProvider>
        <NavLink href="/a" prefetch="hover" prefetchLoaders={ref}>
          A
        </NavLink>
      </LocationProvider>
    );
    // Pointer enters /a, then the list reorders under a stationary cursor
    // before the intent delay elapses: no pointerLeave fires.
    fireEvent.pointerEnter(getByText('A'));
    vi.advanceTimersByTime(50);
    rerender(
      <LocationProvider>
        <NavLink href="/b" prefetch="hover" prefetchLoaders={ref}>
          A
        </NavLink>
      </LocationProvider>
    );
    vi.advanceTimersByTime(500);
    // The stale timer must not have fired for /a and burned the guard.
    expect(prefetchSpy).not.toHaveBeenCalled();

    fireEvent.focus(getByText('A'));
    expect(prefetchSpy).toHaveBeenCalledTimes(1);
    expect(prefetchSpy).toHaveBeenLastCalledWith('/b');
  });
});
