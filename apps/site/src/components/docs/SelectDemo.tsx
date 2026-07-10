import { Select } from 'hono-preact-ui';
import { useState } from 'preact/hooks';

// A single-select listbox showing the common parts: a trigger with a
// placeholder Value, plain options, one disabled option, and a labelled
// option group. Styling is in docs.css (.docs-select* / .docs-select-trigger).
export function SelectDemo() {
  const [value, setValue] = useState<string | null>(null);
  return (
    <Select.Root value={value} onValueChange={setValue}>
      <Select.Trigger class="docs-select-trigger">
        <Select.Value class="docs-select__value" placeholder="Pick a fruit" />
        <span class="docs-select__chevron" aria-hidden="true">
          ▾
        </span>
      </Select.Trigger>
      <Select.Positioner class="docs-select-positioner">
        <Select.Popup class="docs-select" aria-label="Fruit">
          <Select.Option class="docs-select__option" value="apple">
            Apple
          </Select.Option>
          <Select.Option class="docs-select__option" value="banana">
            Banana
          </Select.Option>
          <Select.Option class="docs-select__option" value="cherry" disabled>
            Cherry (out of season)
          </Select.Option>
          <Select.OptionGroup class="docs-select__group">
            <Select.OptionGroupLabel class="docs-select__label">
              Citrus
            </Select.OptionGroupLabel>
            <Select.Option class="docs-select__option" value="orange">
              Orange
            </Select.Option>
            <Select.Option class="docs-select__option" value="lemon">
              Lemon
            </Select.Option>
          </Select.OptionGroup>
        </Select.Popup>
      </Select.Positioner>
    </Select.Root>
  );
}
