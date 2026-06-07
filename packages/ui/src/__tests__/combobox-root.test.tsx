// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/preact';
import { useComboboxContext } from '../combobox/context.js';
import { ComboboxRoot } from '../combobox/combobox.js';

afterEach(cleanup);

function Probe({
  onReady,
}: {
  onReady: (ctx: ReturnType<typeof useComboboxContext>) => void;
}) {
  const ctx = useComboboxContext('Probe');
  onReady(ctx);
  return null;
}

describe('ComboboxRoot', () => {
  it('provides context with defaults', () => {
    let ctx!: ReturnType<typeof useComboboxContext>;
    render(
      <ComboboxRoot>
        <Probe onReady={(c) => (ctx = c)} />
      </ComboboxRoot>
    );
    expect(ctx.open).toBe(false);
    expect(ctx.multiple).toBe(false);
    expect(ctx.autocomplete).toBe('list');
    expect(ctx.inputValue).toBe('');
  });

  it('emits hidden form fields for the committed value', async () => {
    let ctx!: ReturnType<typeof useComboboxContext>;
    const { container } = render(
      <ComboboxRoot name="fruit" defaultValue="apple">
        <Probe onReady={(c) => (ctx = c)} />
      </ComboboxRoot>
    );
    await act(async () => {});
    const hidden = container.querySelector(
      'input[type="hidden"][name="fruit"]'
    );
    expect((hidden as HTMLInputElement).value).toBe('apple');
  });

  it('throws when a part is used outside Root', () => {
    expect(() => render(<Probe onReady={() => {}} />)).toThrow(
      /<Combobox.Probe> must be used within <Combobox.Root>/
    );
  });
});
