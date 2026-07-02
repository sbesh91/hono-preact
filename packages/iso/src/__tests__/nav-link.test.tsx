// @vitest-environment happy-dom
import { afterEach, describe, it, expect, vi } from 'vitest';
import { cleanup, render, fireEvent } from '@testing-library/preact';
import { h } from 'preact';
import { LocationProvider } from 'preact-iso';
import { NavLink } from '../nav-link.js';
import * as routeChange from '../internal/route-change.js';

afterEach(() => {
  cleanup();
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
});
