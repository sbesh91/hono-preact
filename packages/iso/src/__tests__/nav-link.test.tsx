// @vitest-environment happy-dom
import { afterEach, describe, it, expect } from 'vitest';
import { cleanup, render } from '@testing-library/preact';
import { LocationProvider } from 'preact-iso';
import { NavLink } from '../nav-link.js';

afterEach(() => {
  cleanup();
  history.replaceState(null, '', '/');
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
});
