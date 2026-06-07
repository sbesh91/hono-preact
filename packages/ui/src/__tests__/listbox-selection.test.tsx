// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/preact';
import { useEffect, useId, useState } from 'preact/hooks';
import { useListboxSelection } from '../listbox/selection.js';

afterEach(cleanup);

// A tiny harness exercising the hook the way a Root + Options would.
function Harness({
  multiple = false,
  itemToString,
  renderCherry = true,
  onReady,
}: {
  multiple?: boolean;
  itemToString?: (v: string) => string;
  renderCherry?: boolean;
  onReady?: (api: ReturnType<typeof useListboxSelection<string>>) => void;
}) {
  const [value, setValue] = useState<string | string[] | undefined>(
    multiple ? [] : undefined
  );
  const [open, setOpen] = useState(true);
  const sel = useListboxSelection<string>({
    value,
    setValue,
    multiple,
    setOpen,
    itemToString,
    name: 'fruit',
  });
  onReady?.(sel);
  return (
    <form data-testid="form">
      <Option sel={sel} value="apple" label="Apple" />
      {renderCherry && <Option sel={sel} value="cherry" label="Cherry" />}
      {sel.hiddenFields}
      <span data-testid="open">{String(open)}</span>
    </form>
  );
}

function Option({
  sel,
  value,
  label,
}: {
  sel: ReturnType<typeof useListboxSelection<string>>;
  value: string;
  label: string;
}) {
  const id = useId();
  useEffect(() => sel.registerOption(id, value, label), [id, value, label]);
  return (
    <div role="option" id={id} aria-selected={sel.isSelected(value)}>
      {label}
    </div>
  );
}

describe('useListboxSelection', () => {
  it('single select toggles value and closes', async () => {
    let api!: ReturnType<typeof useListboxSelection<string>>;
    const { getByTestId } = render(<Harness onReady={(a) => (api = a)} />);
    await act(async () => api.toggle('apple'));
    expect(getByTestId('open').textContent).toBe('false');
    expect(api.isSelected('apple')).toBe(true);
  });

  it('emits a hidden field per name carrying the serialized value', async () => {
    let api!: ReturnType<typeof useListboxSelection<string>>;
    const { container } = render(<Harness onReady={(a) => (api = a)} />);
    await act(async () => api.toggle('apple'));
    const hidden = container.querySelector('input[type="hidden"][name="fruit"]');
    expect(hidden).not.toBeNull();
    expect((hidden as HTMLInputElement).value).toBe('apple');
  });

  it('labelFor falls back to the value-to-label cache after the option unmounts', async () => {
    let api!: ReturnType<typeof useListboxSelection<string>>;
    const { rerender } = render(
      <Harness renderCherry={true} onReady={(a) => (api = a)} />
    );
    await act(async () => api.toggle('cherry')); // snapshots "Cherry" into the cache
    rerender(<Harness renderCherry={false} onReady={(a) => (api = a)} />); // cherry unmounts
    await act(async () => {});
    expect(api.labelFor('cherry')).toBe('Cherry');
  });

  it('labelFor uses itemToString when neither registry nor cache has the value', () => {
    let api!: ReturnType<typeof useListboxSelection<string>>;
    render(
      <Harness itemToString={(v) => `#${v}`} onReady={(a) => (api = a)} />
    );
    expect(api.labelFor('durian')).toBe('#durian');
  });
});
