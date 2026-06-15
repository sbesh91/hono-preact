import { Select } from 'hono-preact-ui';
import { useState } from 'preact/hooks';

// A multiple-select listbox. Picking an option toggles it and keeps the popup
// open; the Value joins the selected labels. Styling is in root.css.
export function SelectMultiDemo() {
  const [value, setValue] = useState<string[]>([]);
  return (
    <Select.Root
      multiple
      value={value}
      onValueChange={(v) => setValue(Array.isArray(v) ? v : [v])}
    >
      <Select.Trigger class="docs-select-trigger">
        <Select.Value class="docs-select__value" placeholder="Pick toppings" />
        <span class="docs-select__chevron" aria-hidden="true">
          ▾
        </span>
      </Select.Trigger>
      <Select.Positioner class="docs-select-positioner">
        <Select.Popup class="docs-select" aria-label="Toppings">
          <Select.Option class="docs-select__option" value="cheese">
            Cheese
          </Select.Option>
          <Select.Option class="docs-select__option" value="mushroom">
            Mushroom
          </Select.Option>
          <Select.Option class="docs-select__option" value="pepperoni">
            Pepperoni
          </Select.Option>
          <Select.Option class="docs-select__option" value="olive">
            Olive
          </Select.Option>
        </Select.Popup>
      </Select.Positioner>
    </Select.Root>
  );
}
