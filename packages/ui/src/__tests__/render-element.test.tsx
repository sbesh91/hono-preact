// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
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

// A trigger-flavored part: framework props carry a click handler, matching
// the signal renderElement uses to decide an element must be focusable
// (see isInteractiveTrigger in render-element.ts).
function TriggerWidget(props: {
  render?: RenderProp<{ active: boolean }>;
  onFrameworkClick?: () => void;
}) {
  return renderElement<{ active: boolean }>({
    render: props.render,
    defaultTag: 'button',
    props: {
      class: 'fw',
      type: 'button',
      onClick: props.onFrameworkClick ?? (() => {}),
    },
    state: { active: false },
    children: 'label',
  });
}

// Mirrors a presentational part like SelectValue/ComboboxValue: a
// non-focusable defaultTag, and consumer props (which may include onClick)
// spread straight into framework props via ...rest. No render override.
function PresentationalWidget(props: { onClick?: () => void }) {
  return renderElement<Record<never, never>>({
    defaultTag: 'span',
    props: { class: 'fw', onClick: props.onClick },
    state: {},
    children: 'value',
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
        render={
          <span
            class="user"
            ref={(n) => {
              refNode = n;
            }}
          />
        }
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

  it('composes function props user-first on a render-prop vnode', () => {
    const calls: string[] = [];
    const { container } = render(
      <TriggerWidget
        onFrameworkClick={() => calls.push('part')}
        render={
          <button
            onClick={() => {
              calls.push('user');
            }}
          />
        }
      />
    );
    const el = container.querySelector('button')!;
    el.click();
    expect(calls).toEqual(['user', 'part']);
  });

  it('does not compose a colliding non-handler function prop; the framework function wins outright', () => {
    const frameworkFormat = (): string => 'framework';
    const userFormat = (): string => 'user';
    interface FormattableProps {
      format?: () => string;
    }
    const vnode = renderElement<{ active: boolean }>({
      render: h<FormattableProps>('button', { format: userFormat }),
      defaultTag: 'button',
      props: { format: frameworkFormat },
      state: { active: false },
      children: 'label',
    });
    const props: unknown = vnode.props;
    const hasFormat = (p: unknown): p is FormattableProps =>
      typeof p === 'object' &&
      p !== null &&
      'format' in p &&
      typeof p.format === 'function';
    expect(hasFormat(props)).toBe(true);
    // A key that does not match the /^on[A-Z]/ handler convention must not be
    // composed: the framework's own function replaces the user's outright,
    // not a wrapper that calls both.
    if (hasFormat(props)) expect(props.format).toBe(frameworkFormat);
  });

  it('still lets framework win for non-function prop collisions', () => {
    // Widget's framework props set data-fw='yes'; the user side never
    // provides that key here, so use `type` (framework sets 'button') to
    // pin that a same-key, non-function collision resolves framework-first,
    // unaffected by handler composition.
    const { container } = render(<Widget render={<button type="submit" />} />);
    const el = container.querySelector('button')!;
    expect(el.type).toBe('button');
  });

  describe('non-focusable trigger dev-warning', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('dev-warns when a render trigger resolves to a non-focusable element', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { container } = render(<TriggerWidget render={<span />} />);
      expect(container.querySelector('span')).toBeTruthy();
      expect(warn).toHaveBeenCalledTimes(1);
      const message = warn.mock.calls[0]?.[0] as string;
      expect(message).toContain('span');
      expect(message).toMatch(/button|tabindex/i);
    });

    it('does not warn for a button, or for a span with explicit tabindex', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      render(<TriggerWidget render={<button />} />);
      render(<TriggerWidget render={<span tabIndex={0} />} />);
      expect(warn).not.toHaveBeenCalled();
    });

    it('does not warn for a consumer onClick on a plain default-tag part (no render override)', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { container } = render(<PresentationalWidget onClick={() => {}} />);
      expect(container.querySelector('span')).toBeTruthy();
      expect(warn).not.toHaveBeenCalled();
    });

    it('still warns for a render-override span with a framework onClick', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      render(<TriggerWidget render={<span />} />);
      expect(warn).toHaveBeenCalledTimes(1);
    });

    it('warns for an <a> without an href (not focusable)', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { container } = render(<TriggerWidget render={<a />} />);
      expect(container.querySelector('a')).toBeTruthy();
      expect(warn).toHaveBeenCalledTimes(1);
    });

    it('does not warn for an <a> with an href (focusable)', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      render(<TriggerWidget render={<a href="/x" />} />);
      expect(warn).not.toHaveBeenCalled();
    });

    it('warns for a disabled button (not focusable)', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { container } = render(
        <TriggerWidget render={<button disabled />} />
      );
      expect(container.querySelector('button')).toBeTruthy();
      expect(warn).toHaveBeenCalledTimes(1);
    });

    it('warns for a disabled input (not focusable)', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      render(<TriggerWidget render={<input disabled />} />);
      expect(warn).toHaveBeenCalledTimes(1);
    });

    it('does not warn for a render-override element with tabIndex={-1} (roving tabindex)', () => {
      // Menu.Item and other roving-tabindex parts set tabIndex={-1} while
      // unhighlighted, and menu popup/popover/combobox parts use
      // tabindex="-1" intentionally while remaining focusable via script.
      // An author-set tabindex, even -1, declares focusability intent and
      // must not trip the dev-warn.
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      render(<TriggerWidget render={<span tabIndex={-1} />} />);
      expect(warn).not.toHaveBeenCalled();
    });
  });
});
