// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/preact';
import { useNavigate, type NavigateOptions } from '../use-navigate.js';
import * as routeChange from '../internal/route-change.js';

const mockRoute = vi.fn();
vi.mock('preact-iso', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, useLocation: () => ({ route: mockRoute }) };
});

beforeEach(() => mockRoute.mockClear());
afterEach(() => {
  cleanup();
  history.replaceState(null, '', '/');
  // Each transition test spies on the same skipNextNavTransition export; restore
  // so a failing test's unrestored spy does not stay wrapped and leak into the
  // next (mirrors nav-link.test.tsx).
  vi.restoreAllMocks();
});

function Harness({
  path,
  options,
}: {
  path: string;
  options?: NavigateOptions;
}) {
  const navigate = useNavigate();
  return <button onClick={() => navigate(path, options)}>go</button>;
}

function click() {
  document.querySelector('button')!.click();
}

describe('useNavigate', () => {
  it('soft-navigates via route() with replace=false by default', () => {
    render(<Harness path="/x" />);
    click();
    expect(mockRoute).toHaveBeenCalledWith('/x', false);
  });

  it('passes replace through to route()', () => {
    render(<Harness path="/x" options={{ replace: true }} />);
    click();
    expect(mockRoute).toHaveBeenCalledWith('/x', true);
  });

  it('reload does a hard navigation and does NOT soft-navigate', () => {
    const assign = vi
      .spyOn(window.location, 'assign')
      .mockImplementation(() => {});
    render(<Harness path="/x" options={{ reload: true }} />);
    click();
    expect(assign).toHaveBeenCalledWith('/x');
    expect(mockRoute).not.toHaveBeenCalled();
    assign.mockRestore();
  });

  it('arms skipNextNavTransition keyed to the target on a soft nav when transition is false', () => {
    const spy = vi.spyOn(routeChange, 'skipNextNavTransition');
    render(
      <Harness path="/x?tab=2" options={{ replace: true, transition: false }} />
    );
    click();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith('/x?tab=2');
    expect(mockRoute).toHaveBeenCalledWith('/x?tab=2', true);
    spy.mockRestore();
  });

  // A same-URL target arms like any other: the arm is keyed, so when the
  // same-URL push produces no navigated flush it expires at the next navigated
  // flush to any other URL instead of stranding (scheduler-side expiry is
  // pinned in skip-view-transition.test.ts).
  it('arms keyed even when navigating to the current URL', () => {
    history.replaceState(null, '', '/');
    const spy = vi.spyOn(routeChange, 'skipNextNavTransition');
    render(<Harness path="/" options={{ transition: false }} />);
    click();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith('/');
    expect(mockRoute).toHaveBeenCalledWith('/', false);
    spy.mockRestore();
  });

  it('does not arm skipNextNavTransition when transition is omitted', () => {
    const spy = vi.spyOn(routeChange, 'skipNextNavTransition');
    render(<Harness path="/x" />);
    click();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('does not arm on a reload (hard) navigation even when transition is false', () => {
    const spy = vi.spyOn(routeChange, 'skipNextNavTransition');
    const assign = vi
      .spyOn(window.location, 'assign')
      .mockImplementation(() => {});
    render(<Harness path="/x" options={{ reload: true, transition: false }} />);
    click();
    expect(spy).not.toHaveBeenCalled();
    expect(assign).toHaveBeenCalledWith('/x');
    assign.mockRestore();
    spy.mockRestore();
  });
});

describe('useNavigate fragment targets', () => {
  it('a fragment target pushes the hash and scrolls, and does not soft-navigate', () => {
    history.replaceState(null, '', '/docs/x');
    const target = document.createElement('h2');
    target.id = 'usage';
    const scrollSpy = vi.fn();
    target.scrollIntoView = scrollSpy;
    document.body.appendChild(target);

    render(<Harness path="#usage" />);
    click();

    expect(location.pathname).toBe('/docs/x');
    expect(location.hash).toBe('#usage');
    expect(mockRoute).not.toHaveBeenCalled();
    expect(scrollSpy).toHaveBeenCalledWith({ block: 'start' });
    target.remove();
  });

  it('replace on a fragment target replaces the history entry instead of pushing', () => {
    history.replaceState(null, '', '/docs/x');
    const pushSpy = vi.spyOn(history, 'pushState');
    const replaceSpy = vi.spyOn(history, 'replaceState');
    render(<Harness path="#usage" options={{ replace: true }} />);
    click();
    expect(replaceSpy).toHaveBeenCalledWith(null, '', '#usage');
    expect(pushSpy).not.toHaveBeenCalled();
    expect(mockRoute).not.toHaveBeenCalled();
  });

  it('a fragment target with no matching element still writes the hash without throwing', () => {
    history.replaceState(null, '', '/docs/x');
    render(<Harness path="#missing" />);
    click();
    expect(location.hash).toBe('#missing');
    expect(mockRoute).not.toHaveBeenCalled();
  });

  it('does not arm the skip for a fragment target even when transition is false', () => {
    // Hash-only URL changes never animate, so transition: false is a no-op
    // for fragments and must not leave an arm behind.
    history.replaceState(null, '', '/docs/x');
    const spy = vi.spyOn(routeChange, 'skipNextNavTransition');
    render(<Harness path="#usage" options={{ transition: false }} />);
    click();
    expect(spy).not.toHaveBeenCalled();
    expect(mockRoute).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('does not push a duplicate history entry when the fragment target is already current', () => {
    history.replaceState(null, '', '/docs/x#usage');
    const target = document.createElement('h2');
    target.id = 'usage';
    const scrollSpy = vi.fn();
    target.scrollIntoView = scrollSpy;
    document.body.appendChild(target);
    const pushSpy = vi.spyOn(history, 'pushState');
    const replaceSpy = vi.spyOn(history, 'replaceState');

    render(<Harness path="#usage" />);
    click();

    expect(pushSpy).not.toHaveBeenCalled();
    expect(replaceSpy).not.toHaveBeenCalled();
    expect(scrollSpy).toHaveBeenCalledWith({ block: 'start' });
    target.remove();
  });
});
