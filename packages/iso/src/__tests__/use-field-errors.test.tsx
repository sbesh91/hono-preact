// @vitest-environment happy-dom
import { describe, expect, it, afterEach } from 'vitest';
import { h, type VNode } from 'preact';
import { cleanup, render } from '@testing-library/preact';
import { FieldError } from '../use-field-errors.js';
import { FieldErrorsContext } from '../internal/field-errors-context.js';

afterEach(() => {
  cleanup();
});

function withErrors(errors: Record<string, string[]>, node: VNode) {
  return render(h(FieldErrorsContext.Provider, { value: errors }, node));
}

describe('FieldError', () => {
  it('renders the first message in a default <span> with the a11y/data contract', () => {
    const { container } = withErrors(
      { title: ['Required', 'second'] },
      <FieldError name="title" />
    );
    const el = container.querySelector('[data-field-error="title"]')!;
    expect(el).toBeTruthy();
    expect(el.tagName).toBe('SPAN');
    expect(el.getAttribute('role')).toBe('alert');
    expect(el.textContent).toBe('Required'); // first message only
  });

  it('renders nothing when the field is valid', () => {
    const { container } = withErrors({}, <FieldError name="title" />);
    expect(container.querySelector('[data-field-error]')).toBeNull();
  });

  it('render="p" swaps the tag while keeping the framework props + message', () => {
    const { container } = withErrors(
      { title: ['Required'] },
      <FieldError name="title" render="p" />
    );
    const el = container.querySelector('[data-field-error="title"]')!;
    expect(el.tagName).toBe('P');
    expect(el.getAttribute('role')).toBe('alert');
    expect(el.textContent).toBe('Required');
  });

  it('render={<VNode/>} merges framework props onto the custom element', () => {
    const { container } = withErrors(
      { title: ['Required'] },
      <FieldError name="title" class="base" render={<strong class="extra" />} />
    );
    const el = container.querySelector('[data-field-error="title"]')!;
    expect(el.tagName).toBe('STRONG');
    // user class on the render element is merged with the FieldError class prop
    expect(el.className.split(' ').sort()).toEqual(['base', 'extra']);
    expect(el.textContent).toBe('Required');
  });

  it('render function receives the framework props', () => {
    let seen: Record<string, unknown> | undefined;
    withErrors(
      { title: ['Required'] },
      <FieldError
        name="title"
        render={(props) => {
          seen = props;
          return h('em', props, 'custom');
        }}
      />
    );
    expect(seen?.['data-field-error']).toBe('title');
    expect(seen?.role).toBe('alert');
  });

  it('name="" renders form-level errors', () => {
    const { container } = withErrors(
      { '': ['Form-level problem'] },
      <FieldError name="" />
    );
    expect(container.querySelector('[data-field-error=""]')?.textContent).toBe(
      'Form-level problem'
    );
  });
});
