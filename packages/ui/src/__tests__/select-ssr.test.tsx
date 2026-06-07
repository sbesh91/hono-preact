// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import {
  SelectRoot,
  SelectTrigger,
  SelectValue,
  SelectPositioner,
  SelectPopup,
  SelectOption,
} from '../select/select.js';

describe('Select SSR', () => {
  it('renders the combobox + hidden field and a hidden listbox on the server', () => {
    const html = renderToString(
      <SelectRoot name="fruit" defaultValue="banana">
        <SelectTrigger>
          <SelectValue placeholder="Pick" />
        </SelectTrigger>
        <SelectPositioner>
          <SelectPopup aria-label="Fruits">
            <SelectOption value="apple">Apple</SelectOption>
            <SelectOption value="banana">Banana</SelectOption>
          </SelectPopup>
        </SelectPositioner>
      </SelectRoot>
    );
    expect(html).toContain('role="combobox"');
    expect(html).toContain('role="listbox"');
    expect(html).toContain('hidden'); // listbox hidden while closed
    expect(html).toContain('name="fruit"');
    expect(html).toContain('value="banana"');
  });
});
