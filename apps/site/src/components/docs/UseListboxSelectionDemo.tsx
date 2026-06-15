import { useListboxSelection } from 'hono-preact-ui';
import { useId, useLayoutEffect, useState } from 'preact/hooks';

const FRUITS = ['Apple', 'Banana', 'Cherry', 'Date'];

// A small option row that registers itself in the selection's label registry and
// reflects/toggles its own selected state. Prop types for isSelected/toggle/
// register mirror the actual hook return types (all accept unknown) so no cast
// is needed.
function Option(props: {
  value: string;
  isSelected: (v: unknown) => boolean;
  toggle: (v: unknown) => void;
  register: (id: string, value: unknown, label: string) => () => void;
}) {
  const { value, isSelected, toggle, register } = props;
  const id = useId();
  useLayoutEffect(() => register(id, value, value), [id, value, register]);
  const selected = isSelected(value);
  return (
    <li
      id={id}
      role="option"
      aria-selected={selected}
      data-selected={selected ? '' : undefined}
      class="docs-listboxsel-option"
      onClick={() => toggle(value)}
    >
      {value}
    </li>
  );
}

// The selection core shared by Select and Combobox: single/multi value tracking,
// a label registry resolving display labels in DOM order, and hidden form-field
// serialization. Toggle multi-select; the readout shows selectedLabels() and the
// hidden fields render below. Styling: .docs-listboxsel* in root.css.
export function UseListboxSelectionDemo() {
  const [multiple, setMultiple] = useState(false);
  const [value, setValue] = useState<string | string[] | undefined>(undefined);
  const [, setOpen] = useState(true);

  const sel = useListboxSelection<string>({
    value,
    setValue: (next) => setValue(next),
    multiple,
    setOpen,
    name: 'fruit',
  });

  return (
    <div class="docs-listboxsel">
      <label class="docs-listboxsel-mode">
        <input
          type="checkbox"
          checked={multiple}
          onChange={(e) => {
            setMultiple(e.currentTarget.checked);
            setValue(undefined);
          }}
        />
        multiple
      </label>
      <ul
        role="listbox"
        aria-multiselectable={multiple}
        class="docs-listboxsel-list"
      >
        {FRUITS.map((f) => (
          <Option
            key={f}
            value={f}
            isSelected={sel.isSelected}
            toggle={sel.toggle}
            register={sel.registerOption}
          />
        ))}
      </ul>
      <p class="docs-listboxsel-readout">
        selected: <strong>{sel.selectedLabels().join(', ') || '(none)'}</strong>
      </p>
      {sel.hiddenFields}
    </div>
  );
}
