import { renderElement, type RenderProp } from 'hono-preact-ui';
import type { ComponentChildren, JSX, VNode } from 'preact';
import { useState } from 'preact/hooks';

type DemoButtonProps = {
  render?: RenderProp<{ pressed: boolean }>;
  pressed?: boolean;
  children?: ComponentChildren;
} & Omit<JSX.HTMLAttributes<HTMLButtonElement>, 'children'>;

// The render-prop Button from the docs page, built on renderElement.
function DemoButton({
  render,
  pressed = false,
  children,
  ...rest
}: DemoButtonProps): VNode {
  return renderElement<{ pressed: boolean }>({
    render,
    defaultTag: 'button',
    props: {
      ...rest,
      type: 'button',
      'data-pressed': pressed ? '' : undefined,
    },
    state: { pressed },
    children,
  });
}

// The same Button rendered three ways: the default <button>, an <a> to clone
// (a real anchor, opens in a new tab), and the function form that reads the
// component's state. Styling: .docs-renderel* in root.css.
export function RenderElementDemo() {
  const [pressed, setPressed] = useState(false);
  return (
    <div class="docs-renderel">
      <DemoButton
        class="docs-renderel-btn"
        pressed={pressed}
        onClick={() => setPressed((p) => !p)}
      >
        {pressed ? 'pressed' : 'default <button>'}
      </DemoButton>

      <DemoButton
        class="docs-renderel-btn"
        render={
          <a
            href="https://preactjs.com"
            target="_blank"
            rel="noreferrer noopener"
          />
        }
      >
        render=&lt;a&gt;
      </DemoButton>

      <DemoButton
        class="docs-renderel-btn"
        pressed={pressed}
        onClick={() => setPressed((p) => !p)}
        render={(props, state) => (
          <span {...props} role="button" tabIndex={0}>
            {state.pressed ? 'pressed (fn)' : 'render=fn'}
          </span>
        )}
      />
    </div>
  );
}
