// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/preact';
import { LocationProvider } from 'preact-iso';
import { NavLink } from '../nav-link.js';
import type { AnyLoaderRef } from '../define-loader.js';

// Records the href it was constructed with each time the returned callback
// fires, so a test can tell which target a given prefetch call was for.
const prefetchSpy = vi.fn();
vi.mock('../use-prefetch.js', () => ({
  usePrefetch: (href: string, _refs: unknown) => () => prefetchSpy(href),
}));

const ref = { __id: Symbol('r') } as unknown as AnyLoaderRef;

describe('NavLink prefetch', () => {
  beforeEach(() => {
    prefetchSpy.mockClear();
    vi.useFakeTimers();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
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
});
