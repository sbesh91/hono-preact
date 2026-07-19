// @vitest-environment happy-dom
import { afterEach, describe, it, expect, vi } from 'vitest';
import { cleanup, render, fireEvent } from '@testing-library/preact';
import { h, options } from 'preact';
import { LocationProvider } from 'preact-iso';
import { NavLink } from '../nav-link.js';
import * as routeChange from '../internal/route-change.js';

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

type DocWithVt = Document & {
  startViewTransition?: (cb: () => void | Promise<void>) => unknown;
};

afterEach(() => {
  cleanup();
  // Some tests below install the nav-transition scheduler and a fake
  // startViewTransition on the real document; reset both.
  routeChange.__resetTransitionStateForTesting();
  delete (document as DocWithVt).startViewTransition;
  history.replaceState(null, '', '/');
  // The transition-arming tests below vi.spyOn the same module export in each
  // test; without restoring, an earlier test's spy stays wrapped around the
  // real function and each later spy call also re-invokes it.
  vi.restoreAllMocks();
});

describe('NavLink', () => {
  it('applies activeClass and aria-current="page" when active', () => {
    history.replaceState(null, '', '/docs');
    const { getByText } = render(
      <LocationProvider>
        <NavLink href="/docs" class="base" activeClass="on" inactiveClass="off">
          Docs
        </NavLink>
      </LocationProvider>
    );
    const a = getByText('Docs') as HTMLAnchorElement;
    expect(a.getAttribute('class')).toBe('base on');
    expect(a.getAttribute('aria-current')).toBe('page');
  });

  it('applies inactiveClass and no aria-current when inactive', () => {
    history.replaceState(null, '', '/other');
    const { getByText } = render(
      <LocationProvider>
        <NavLink href="/docs" class="base" activeClass="on" inactiveClass="off">
          Docs
        </NavLink>
      </LocationProvider>
    );
    const a = getByText('Docs') as HTMLAnchorElement;
    expect(a.getAttribute('class')).toBe('base off');
    expect(a.getAttribute('aria-current')).toBeNull();
  });

  it('uses `match` for the active test instead of href', () => {
    history.replaceState(null, '', '/posts/7');
    const { getByText } = render(
      <LocationProvider>
        <NavLink href="/posts" match="/posts/:id" activeClass="on">
          Posts
        </NavLink>
      </LocationProvider>
    );
    const a = getByText('Posts') as HTMLAnchorElement;
    expect(a.getAttribute('href')).toBe('/posts');
    expect(a.getAttribute('class')).toBe('on');
  });

  it('matches a descendant when exact is false', () => {
    history.replaceState(null, '', '/docs/components/dialog');
    const { getByText } = render(
      <LocationProvider>
        <NavLink
          href="/docs/components"
          exact={false}
          activeClass="on"
          inactiveClass="off"
        >
          Components
        </NavLink>
      </LocationProvider>
    );
    expect((getByText('Components') as HTMLElement).getAttribute('class')).toBe(
      'on'
    );
  });

  it('forwards arbitrary anchor props', () => {
    history.replaceState(null, '', '/x');
    const { getByText } = render(
      <LocationProvider>
        <NavLink href="/y" target="_blank" rel="noreferrer" data-kind="nav">
          Y
        </NavLink>
      </LocationProvider>
    );
    const a = getByText('Y') as HTMLAnchorElement;
    expect(a.getAttribute('target')).toBe('_blank');
    expect(a.getAttribute('rel')).toBe('noreferrer');
    expect(a.getAttribute('data-kind')).toBe('nav');
  });

  it('omits the class attribute when no class props are given', () => {
    history.replaceState(null, '', '/docs');
    const { getByText } = render(
      <LocationProvider>
        <NavLink href="/docs">Docs</NavLink>
      </LocationProvider>
    );
    expect(getByText('Docs').getAttribute('class')).toBeNull();
  });

  it('lets a caller-supplied aria-current win over the default', () => {
    history.replaceState(null, '', '/docs');
    const { getByText } = render(
      <LocationProvider>
        {/* active, but the caller forces aria-current off */}
        <NavLink href="/docs" aria-current={false} activeClass="on">
          Docs
        </NavLink>
      </LocationProvider>
    );
    expect(getByText('Docs').getAttribute('aria-current')).toBe('false');
  });

  // The suppression is a presence check on the `aria-current` prop, so an
  // explicit `aria-current={undefined}` opts out of the computed value even on
  // an active path (an omitted prop still computes `page`). Distinguishing the
  // two relies on the JSX transform keeping the written-but-undefined key
  // present in props.
  it('suppresses the computed aria-current when aria-current is explicitly undefined', () => {
    history.replaceState(null, '', '/x');
    const { getByText } = render(
      <LocationProvider>
        <NavLink href="/x" aria-current={undefined} activeClass="on">
          X
        </NavLink>
      </LocationProvider>
    );
    const a = getByText('X') as HTMLAnchorElement;
    expect(a.getAttribute('aria-current')).toBeNull();
    // Opting out of aria-current must not disable active-class styling.
    expect(a.getAttribute('class')).toBe('on');
  });

  it('passes an explicit aria-current="page" through on an inactive path', () => {
    history.replaceState(null, '', '/other');
    const { getByText } = render(
      <LocationProvider>
        <NavLink href="/docs" aria-current="page">
          Docs
        </NavLink>
      </LocationProvider>
    );
    expect(getByText('Docs').getAttribute('aria-current')).toBe('page');
  });

  // These four wrap in <LocationProvider>, unlike the verbatim brief snippet,
  // because NavLink's useRouteActive calls useLocation() and throws without a
  // location context ancestor (see every other test in this file).

  it('arms skipNextNavTransition on a plain left-click when transition is false', () => {
    const spy = vi.spyOn(routeChange, 'skipNextNavTransition');
    const { getByText } = render(
      h(
        LocationProvider,
        null,
        h(NavLink, { href: '/a', transition: false }, 'go')
      )
    );
    fireEvent.click(getByText('go'), { button: 0 });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(new URL('/a', location.href).href);
    cleanup();
  });

  it('does not arm on a modifier-click', () => {
    const spy = vi.spyOn(routeChange, 'skipNextNavTransition');
    const { getByText } = render(
      h(
        LocationProvider,
        null,
        h(NavLink, { href: '/a', transition: false }, 'go')
      )
    );
    fireEvent.click(getByText('go'), { button: 0, metaKey: true });
    expect(spy).not.toHaveBeenCalled();
    cleanup();
  });

  it('still invokes a caller-provided onClick', () => {
    const onClick = vi.fn();
    const { getByText } = render(
      h(
        LocationProvider,
        null,
        h(NavLink, { href: '/a', transition: false, onClick }, 'go')
      )
    );
    fireEvent.click(getByText('go'), { button: 0 });
    expect(onClick).toHaveBeenCalledTimes(1);
    cleanup();
  });

  it('does not arm when transition is omitted', () => {
    const spy = vi.spyOn(routeChange, 'skipNextNavTransition');
    const { getByText } = render(
      h(LocationProvider, null, h(NavLink, { href: '/a' }, 'go'))
    );
    fireEvent.click(getByText('go'), { button: 0 });
    expect(spy).not.toHaveBeenCalled();
    cleanup();
  });

  // The tests below cover the cases preact-iso does NOT client-side
  // soft-navigate for: a bare hash-only link, a download link, and a
  // cross-origin link. The browser handles those clicks itself, so no soft
  // navigation follows and NavLink must not arm. The next two confirm arming
  // still happens for a real same-origin soft-nav, including an href with a
  // trailing hash fragment and a bare `self` target.

  it('does not arm on a bare hash-only link (in-page jump)', () => {
    history.replaceState(null, '', '/x');
    const spy = vi.spyOn(routeChange, 'skipNextNavTransition');
    const { getByText } = render(
      h(
        LocationProvider,
        null,
        h(NavLink, { href: '#frag', transition: false }, 'go')
      )
    );
    fireEvent.click(getByText('go'), { button: 0 });
    expect(spy).not.toHaveBeenCalled();
    cleanup();
  });

  it('does not arm on a download link', () => {
    history.replaceState(null, '', '/x');
    const spy = vi.spyOn(routeChange, 'skipNextNavTransition');
    const { getByText } = render(
      h(
        LocationProvider,
        null,
        h(NavLink, { href: '/file', download: true, transition: false }, 'go')
      )
    );
    fireEvent.click(getByText('go'), { button: 0 });
    expect(spy).not.toHaveBeenCalled();
    cleanup();
  });

  it('does not arm on a cross-origin link', () => {
    history.replaceState(null, '', '/x');
    const spy = vi.spyOn(routeChange, 'skipNextNavTransition');
    const { getByText } = render(
      h(
        LocationProvider,
        null,
        h(NavLink, { href: 'https://example.com/', transition: false }, 'go')
      )
    );
    fireEvent.click(getByText('go'), { button: 0 });
    expect(spy).not.toHaveBeenCalled();
    cleanup();
  });

  it('arms on a real soft-navigation to a different same-origin path', () => {
    history.replaceState(null, '', '/x');
    const spy = vi.spyOn(routeChange, 'skipNextNavTransition');
    const { getByText } = render(
      h(
        LocationProvider,
        null,
        h(NavLink, { href: '/somewhere-else', transition: false }, 'go')
      )
    );
    fireEvent.click(getByText('go'), { button: 0 });
    expect(spy).toHaveBeenCalledTimes(1);
    cleanup();
  });

  // Regression: preact-iso's soft-nav gate only skips a link whose RAW href
  // attribute starts with `#`. A same-path href with a trailing hash fragment
  // still soft-navigates (the URL gains a hash), so the resolved-pathname
  // comparison the old guard used was wrong: it would refuse to arm even
  // though preact-iso does perform a soft-nav here.
  it('arms on a same-path href with a trailing hash fragment', () => {
    history.replaceState(null, '', '/x');
    const spy = vi.spyOn(routeChange, 'skipNextNavTransition');
    const { getByText } = render(
      h(
        LocationProvider,
        null,
        h(NavLink, { href: '/x#frag', transition: false }, 'go')
      )
    );
    fireEvent.click(getByText('go'), { button: 0 });
    expect(spy).toHaveBeenCalledTimes(1);
    cleanup();
  });

  // Minor: preact-iso treats a bare `self` target (no leading underscore) as
  // eligible for soft-nav, same as `_self` or an absent target.
  it('arms on a link with target="self"', () => {
    history.replaceState(null, '', '/x');
    const spy = vi.spyOn(routeChange, 'skipNextNavTransition');
    const { getByText } = render(
      h(
        LocationProvider,
        null,
        h(NavLink, { href: '/y', target: 'self', transition: false }, 'go')
      )
    );
    fireEvent.click(getByText('go'), { button: 0 });
    expect(spy).toHaveBeenCalledTimes(1);
    cleanup();
  });

  // A same-URL click (e.g. the already-active nav item) arms like any other:
  // the arm is keyed to the resolved href, so when preact-iso's same-URL push
  // produces no navigated flush the arm cannot strand. It expires at the next
  // navigation to any other URL, which still gets its view transition.
  it('arms keyed on a same-URL click, and a subsequent different-URL nav still transitions', async () => {
    history.replaceState(null, '', '/x');
    const spy = vi.spyOn(routeChange, 'skipNextNavTransition');
    const { getByText } = render(
      h(
        LocationProvider,
        null,
        h(NavLink, { href: '/x', transition: false }, 'go')
      )
    );
    fireEvent.click(getByText('go'), { button: 0 });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(new URL('/x', location.href).href);
    // Drain any render preact-iso scheduled for the same-URL push before
    // installing the scheduler.
    await tick();

    // Scheduler-level continuation: the keyed arm expires instead of
    // suppressing the next navigation's transition.
    const startViewTransition = vi.fn((cb: () => void | Promise<void>) => {
      void Promise.resolve().then(() => cb());
      return {
        ready: Promise.resolve(),
        updateCallbackDone: Promise.resolve(),
        finished: Promise.resolve(),
        types: { add: () => {} },
        skipTransition: () => {},
      };
    });
    (document as DocWithVt).startViewTransition = startViewTransition;
    routeChange.installNavTransitionScheduler();
    history.pushState(null, '', '/other');
    options.debounceRendering!(() => {});
    await tick();
    expect(startViewTransition).toHaveBeenCalledTimes(1);
    cleanup();
  });

  // Regression (#222 item 14): willSoftNavigate must mirror preact-iso's
  // handleNav gate, which has NO `defaultPrevented` check. An upstream
  // capture-phase preventDefault (e.g. an ancestor handler) does not stop
  // preact-iso from soft-navigating, so the one-shot skip must still arm.
  // Otherwise `transition={false}` silently no-ops and the view transition
  // plays on the very navigation the user opted out of.
  it('arms when an ancestor preventDefault-s the click in the capture phase', () => {
    history.replaceState(null, '', '/x');
    const spy = vi.spyOn(routeChange, 'skipNextNavTransition');
    const { getByText } = render(
      h(
        LocationProvider,
        null,
        h(
          'div',
          { onClickCapture: (e: Event) => e.preventDefault() },
          h(NavLink, { href: '/somewhere-else', transition: false }, 'go')
        )
      )
    );
    fireEvent.click(getByText('go'), { button: 0 });
    expect(spy).toHaveBeenCalledTimes(1);
    cleanup();
  });
});
