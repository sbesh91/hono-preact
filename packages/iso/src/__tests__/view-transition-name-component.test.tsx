// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { cleanup, render } from '@testing-library/preact';
import {
  ViewTransitionName,
  ViewTransitionGroup,
} from '../view-transition-name.js';

let warnSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  // Silence and capture the dev inert-class warning: <ViewTransitionGroup> on a
  // nameless element legitimately warns, so a blanket silent spy keeps that
  // expected noise out of the reporter while the dedicated tests assert on it.
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('<ViewTransitionName>', () => {
  it('renders a div with view-transition-name by default', () => {
    const { container } = render(
      <ViewTransitionName name="hero">child</ViewTransitionName>
    );
    const el = container.firstElementChild as HTMLElement;
    expect(el.tagName).toBe('DIV');
    expect(el.style.getPropertyValue('view-transition-name')).toBe('hero');
    expect(el.textContent).toBe('child');
  });

  it('clones the render element and applies name to it', () => {
    const { container } = render(
      <ViewTransitionName name={`post-1`} render={<article class="card" />}>
        body
      </ViewTransitionName>
    );
    const el = container.firstElementChild as HTMLElement;
    expect(el.tagName).toBe('ARTICLE');
    expect(el.getAttribute('class')).toBe('card');
    expect(el.style.getPropertyValue('view-transition-name')).toBe('post-1');
    expect(el.textContent).toBe('body');
  });

  it('supports render as a function', () => {
    const { container } = render(
      <ViewTransitionName
        name="hero"
        render={(props) => <a {...props} href="/x" />}
      >
        link
      </ViewTransitionName>
    );
    const el = container.firstElementChild as HTMLElement;
    expect(el.tagName).toBe('A');
    expect(el.getAttribute('href')).toBe('/x');
    expect(el.style.getPropertyValue('view-transition-name')).toBe('hero');
  });

  it('applies groupClass via view-transition-class', () => {
    const { container } = render(
      <ViewTransitionName name="hero" groupClass="post">
        x
      </ViewTransitionName>
    );
    const el = container.firstElementChild as HTMLElement;
    expect(el.style.getPropertyValue('view-transition-name')).toBe('hero');
    expect(el.style.getPropertyValue('view-transition-class')).toBe('post');
  });

  it('does not touch the consumer style prop', () => {
    const { container } = render(
      <ViewTransitionName
        name="hero"
        render={<article style={{ color: 'red' }} />}
      >
        x
      </ViewTransitionName>
    );
    const el = container.firstElementChild as HTMLElement;
    expect(el.style.color).toBe('red');
    expect(el.style.getPropertyValue('view-transition-name')).toBe('hero');
  });
});

describe('<ViewTransitionGroup>', () => {
  it('applies view-transition-class', () => {
    const { container } = render(
      <ViewTransitionGroup class="post" render={<article />}>
        x
      </ViewTransitionGroup>
    );
    const el = container.firstElementChild as HTMLElement;
    expect(el.tagName).toBe('ARTICLE');
    expect(el.style.getPropertyValue('view-transition-class')).toBe('post');
  });

  it('accepts an array class', () => {
    const { container } = render(
      <ViewTransitionGroup class={['a', 'b']}>x</ViewTransitionGroup>
    );
    const el = container.firstElementChild as HTMLElement;
    expect(el.style.getPropertyValue('view-transition-class')).toBe('a b');
  });
});

describe('view-transition-class dev warning', () => {
  it('does not warn when <ViewTransitionName> pairs a name with a class', () => {
    render(
      <ViewTransitionName name="hero" groupClass="board-column">
        x
      </ViewTransitionName>
    );
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('warns once when <ViewTransitionGroup> applies a class to a nameless element', () => {
    render(<ViewTransitionGroup class="board-column">x</ViewTransitionGroup>);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0]?.[0])).toContain('board-column');
  });
});
