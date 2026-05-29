// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/preact';
import {
  ViewTransitionName,
  ViewTransitionGroup,
} from '../view-transition-name.js';

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
