import { useControllableState } from 'hono-preact-ui';

// A live On/Off toggle built on useControllableState. Uncontrolled here: it owns
// its own state from defaultValue and the setter is stable across renders.
// Styling: .docs-toggle in root.css.
export function UseControllableStateDemo() {
  const [on, setOn] = useControllableState<boolean>({ defaultValue: false });
  return (
    <button
      type="button"
      class="docs-toggle"
      aria-pressed={on}
      data-pressed={on ? '' : undefined}
      onClick={() => setOn(!on)}
    >
      {on ? 'On' : 'Off'}
    </button>
  );
}
