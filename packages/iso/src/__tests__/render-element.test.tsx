// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/preact';
import { h } from 'preact';
import { renderElement } from '../internal/render-element.js';

function Wrap(props: {
  render?: Parameters<typeof renderElement>[0]['render'];
  defaultTag?: string;
  className?: string;
}) {
  return renderElement({
    render: props.render,
    defaultTag: props.defaultTag ?? 'div',
    props: { class: props.className ?? 'wrap' },
  });
}

describe('renderElement', () => {
  it('renders the default tag with merged props', () => {
    const { container } = render(<Wrap className="x" />);
    const el = container.firstElementChild!;
    expect(el.tagName).toBe('DIV');
    expect(el.getAttribute('class')).toBe('x');
  });

  it('accepts a render element and clones it with merged class', () => {
    const { container } = render(
      <Wrap className="x" render={<article class="card" />} />
    );
    const el = container.firstElementChild!;
    expect(el.tagName).toBe('ARTICLE');
    expect(el.getAttribute('class')).toBe('card x');
  });

  it('accepts a render function and passes merged props', () => {
    const { container } = render(
      <Wrap
        className="x"
        render={(props) => h('section', { ...props, id: 'sec' })}
      />
    );
    const el = container.firstElementChild!;
    expect(el.tagName).toBe('SECTION');
    expect(el.getAttribute('id')).toBe('sec');
    expect(el.getAttribute('class')).toBe('x');
  });

  it('accepts a render string and uses it as the tag', () => {
    const { container } = render(<Wrap className="x" render="aside" />);
    const el = container.firstElementChild!;
    expect(el.tagName).toBe('ASIDE');
  });

  it('joins user class and framework class', () => {
    const { container } = render(
      <Wrap className="framework" render={<a class="user" />} />
    );
    const el = container.firstElementChild!;
    expect(el.getAttribute('class')).toBe('user framework');
  });
});
