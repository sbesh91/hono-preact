// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/preact';
import { LocationProvider } from 'preact-iso';
import { NavLink } from '../nav-link.js';
import type { AnyLoaderRef } from '../define-loader.js';

// Records the href of each prefetch, so a test can tell which target a given
// call was for.
const prefetchSpy = vi.fn();
// Records the full (href, refs) a prefetch was issued with, so a test can
// assert the caller's loader refs actually reach the prefetch machinery rather
// than only that some prefetch happened. Dropping `prefetchLoaders` on the way
// through must fail a test.
const prefetchArgsSpy = vi.fn();
// NavLink reaches the prefetch machinery through a dynamic `import()` of
// `prefetch-for.js`, so that module is what a test mocks. NavLink deliberately
// does NOT import `usePrefetch`: a static edge would put the prefetch graph in
// every app that renders a link. Mocking the hook here would therefore assert
// nothing about NavLink.
vi.mock('../prefetch-for.js', () => ({
  prefetchFor: (href: string, refs: unknown, _routes: unknown) => {
    prefetchArgsSpy(href, refs);
    prefetchSpy(href);
  },
}));

// REAL timers, deliberately. NavLink reaches the prefetch machinery through a
// dynamic `import()`, and vitest resolves a dynamic import through its async
// module runner, which needs a real MACROTASK to settle -- microtask draining
// and `advanceTimersByTimeAsync` both leave it pending, and it stays pending
// even when the module is already cached. Fake timers therefore cannot drive
// this component at all, so these tests wait on real elapsed time instead. The
// waits are bounded by HOVER_INTENT_MS (150 ms) and cost ~1s for the suite.
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Yield a real macrotask so a pending dynamic import can settle. Assertions
// that a prefetch did NOT happen settle too, so they prove "never" rather than
// "not yet".
const flush = () => sleep(0);

// Comfortably past the 150 ms hover-intent debounce.
const PAST_INTENT_MS = 220;
// Comfortably short of it.
const BEFORE_INTENT_MS = 40;

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
    prefetchArgsSpy.mockClear();
    observers = [];
    vi.stubGlobal('IntersectionObserver', TestIntersectionObserver);
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('does not prefetch when the prop is absent', async () => {
    const { getByText } = render(
      <LocationProvider>
        <NavLink href="/a">A</NavLink>
      </LocationProvider>
    );
    fireEvent.pointerEnter(getByText('A'));
    await sleep(PAST_INTENT_MS);
    await flush();
    expect(prefetchSpy).not.toHaveBeenCalled();
  });

  it('hover fires once after the intent delay', async () => {
    const { getByText } = render(
      <LocationProvider>
        <NavLink href="/a" prefetch="hover" prefetchLoaders={ref}>
          A
        </NavLink>
      </LocationProvider>
    );
    fireEvent.pointerEnter(getByText('A'));
    await flush();
    expect(prefetchSpy).not.toHaveBeenCalled(); // debounced, not immediate
    await sleep(PAST_INTENT_MS);
    await flush();
    expect(prefetchSpy).toHaveBeenCalledTimes(1);
  });

  it('leaving before the delay cancels the prefetch', async () => {
    const { getByText } = render(
      <LocationProvider>
        <NavLink href="/a" prefetch="hover" prefetchLoaders={ref}>
          A
        </NavLink>
      </LocationProvider>
    );
    const a = getByText('A');
    fireEvent.pointerEnter(a);
    await sleep(BEFORE_INTENT_MS);
    fireEvent.pointerLeave(a);
    await sleep(PAST_INTENT_MS);
    await flush();
    expect(prefetchSpy).not.toHaveBeenCalled();
  });

  it('focus prefetches immediately for keyboard users', async () => {
    const { getByText } = render(
      <LocationProvider>
        <NavLink href="/a" prefetch="hover" prefetchLoaders={ref}>
          A
        </NavLink>
      </LocationProvider>
    );
    fireEvent.focus(getByText('A'));
    await flush();
    expect(prefetchSpy).toHaveBeenCalledTimes(1);
  });

  it('prefetch={false} disables it', async () => {
    const { getByText } = render(
      <LocationProvider>
        <NavLink href="/a" prefetch={false} prefetchLoaders={ref}>
          A
        </NavLink>
      </LocationProvider>
    );
    fireEvent.pointerEnter(getByText('A'));
    await sleep(PAST_INTENT_MS);
    await flush();
    expect(prefetchSpy).not.toHaveBeenCalled();
  });

  it('does not leak the new props onto the anchor element', async () => {
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

  it('fire-once still holds when hovering the same href repeatedly', async () => {
    const { getByText } = render(
      <LocationProvider>
        <NavLink href="/a" prefetch="hover" prefetchLoaders={ref}>
          A
        </NavLink>
      </LocationProvider>
    );
    const a = getByText('A');
    fireEvent.pointerEnter(a);
    await sleep(PAST_INTENT_MS);
    await flush();
    expect(prefetchSpy).toHaveBeenCalledTimes(1);
    fireEvent.pointerLeave(a);
    fireEvent.pointerEnter(a);
    await sleep(PAST_INTENT_MS);
    await flush();
    expect(prefetchSpy).toHaveBeenCalledTimes(1);
  });

  // SYNTHETIC re-entry only: a real browser cannot fire `pointerenter` twice
  // without an intervening `pointerleave` (it does not bubble and does not
  // re-fire across descendants -- that is `pointerover`). This covers the
  // dispatched-event case, where an un-cleared first timer would be orphaned
  // beyond `handlePointerLeave`'s reach and fire after the cursor left.
  it('a synthetic repeated pointerEnter leaves no orphaned timer', async () => {
    const { getByText } = render(
      <LocationProvider>
        <NavLink href="/a" prefetch="hover" prefetchLoaders={ref}>
          A
        </NavLink>
      </LocationProvider>
    );
    const a = getByText('A');
    fireEvent.pointerEnter(a);
    await sleep(BEFORE_INTENT_MS);
    fireEvent.pointerEnter(a);
    await sleep(BEFORE_INTENT_MS);
    fireEvent.pointerLeave(a);
    await sleep(PAST_INTENT_MS);
    await flush();
    expect(prefetchSpy).not.toHaveBeenCalled();
  });

  it('a changed href on the same instance becomes prefetchable again', async () => {
    const { getByText, rerender } = render(
      <LocationProvider>
        <NavLink href="/a" prefetch="hover" prefetchLoaders={ref}>
          A
        </NavLink>
      </LocationProvider>
    );
    fireEvent.focus(getByText('A'));
    await flush();
    expect(prefetchSpy).toHaveBeenCalledTimes(1);
    await flush();
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
    await flush();
    expect(prefetchSpy).toHaveBeenCalledTimes(2);
    await flush();
    expect(prefetchSpy).toHaveBeenLastCalledWith('/b');
  });

  it('preserves active-state behavior alongside prefetch', async () => {
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

  it('passes a single prefetchLoaders ref through to the prefetch call', async () => {
    const { getByText } = render(
      <LocationProvider>
        <NavLink href="/a" prefetch="hover" prefetchLoaders={ref}>
          A
        </NavLink>
      </LocationProvider>
    );
    fireEvent.focus(getByText('A'));
    await flush();
    expect(prefetchArgsSpy).toHaveBeenLastCalledWith('/a', ref);
  });

  it('passes an array of prefetchLoaders refs through to the prefetch call', async () => {
    const refs = [ref, ref2];
    const { getByText } = render(
      <LocationProvider>
        <NavLink href="/a" prefetch="hover" prefetchLoaders={refs}>
          A
        </NavLink>
      </LocationProvider>
    );
    fireEvent.focus(getByText('A'));
    await flush();
    expect(prefetchArgsSpy).toHaveBeenLastCalledWith('/a', refs);
  });

  it('visible prefetches once the link intersects the viewport', async () => {
    render(
      <LocationProvider>
        <NavLink href="/a" prefetch="visible" prefetchLoaders={ref}>
          A
        </NavLink>
      </LocationProvider>
    );
    expect(observers).toHaveLength(1);
    await flush();
    expect(prefetchSpy).not.toHaveBeenCalled();
    observers[0].trigger(true);
    await flush();
    expect(prefetchSpy).toHaveBeenCalledTimes(1);
    await flush();
    expect(prefetchSpy).toHaveBeenLastCalledWith('/a');
  });

  it('visible does not prefetch while the link is off screen', async () => {
    render(
      <LocationProvider>
        <NavLink href="/a" prefetch="visible" prefetchLoaders={ref}>
          A
        </NavLink>
      </LocationProvider>
    );
    observers[0].trigger(false);
    observers[0].trigger(false);
    await flush();
    expect(prefetchSpy).not.toHaveBeenCalled();
    expect(observers[0].disconnected).toBe(0);
  });

  it('visible disconnects the observer after firing', async () => {
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
    await flush();
    expect(prefetchSpy).toHaveBeenCalledTimes(1);
  });

  it('visible observes the anchor and disconnects on unmount', async () => {
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

  it('an href change mid-debounce leaves the new href prefetchable', async () => {
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
    await sleep(BEFORE_INTENT_MS);
    rerender(
      <LocationProvider>
        <NavLink href="/b" prefetch="hover" prefetchLoaders={ref}>
          A
        </NavLink>
      </LocationProvider>
    );
    await sleep(PAST_INTENT_MS);
    // The stale timer must not have fired for /a and burned the guard.
    await flush();
    expect(prefetchSpy).not.toHaveBeenCalled();

    fireEvent.focus(getByText('A'));
    await flush();
    expect(prefetchSpy).toHaveBeenCalledTimes(1);
    await flush();
    expect(prefetchSpy).toHaveBeenLastCalledWith('/b');
  });
});
