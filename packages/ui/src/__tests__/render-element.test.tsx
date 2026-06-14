// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/preact';
import { h } from 'preact';
import { renderElement, type RenderProp } from '../render-element.js';

function Widget(props: {
  render?: RenderProp<{ active: boolean }>;
  active?: boolean;
}) {
  return renderElement<{ active: boolean }>({
    render: props.render,
    defaultTag: 'button',
    props: { class: 'fw', 'data-fw': 'yes', type: 'button' },
    state: { active: props.active ?? false },
    children: 'label',
  });
}

describe('renderElement', () => {
  it('renders the default tag with framework props and children', () => {
    const { container } = render(<Widget />);
    const el = container.querySelector('button')!;
    expect(el).toBeTruthy();
    expect(el.getAttribute('data-fw')).toBe('yes');
    expect(el.className).toBe('fw');
    expect(el.textContent).toBe('label');
  });

  it('uses a string render as the tag', () => {
    const { container } = render(<Widget render="a" />);
    expect(container.querySelector('a')).toBeTruthy();
    expect(container.querySelector('button')).toBeNull();
  });

  it('merges class and ref when an element is provided as render', () => {
    let refNode: HTMLElement | null = null;
    const { container } = render(
      <Widget
        render={h('span', {
          class: 'user',
          ref: (n: HTMLElement | null) => {
            refNode = n;
          },
        })}
      />
    );
    const el = container.querySelector('span')!;
    expect(el.className).toBe('user fw');
    expect(el.getAttribute('data-fw')).toBe('yes');
    expect(refNode).toBe(el);
  });

  it('calls a function render with merged props and state', () => {
    let receivedState: { active: boolean } | undefined;
    render(
      <Widget
        active
        render={(props, state) => {
          receivedState = state;
          return h('output', props, 'fn');
        }}
      />
    );
    expect(receivedState).toEqual({ active: true });
  });
});
