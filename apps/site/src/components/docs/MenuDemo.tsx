import { Menu } from '@hono-preact/ui';
import { useState } from 'preact/hooks';

// A button-triggered command menu showing every part: plain items, a separator,
// a checkbox item, a single-select radio group, a labelled group, and a nested
// submenu. Styling is in root.css (.docs-menu* / .docs-menu-trigger).
export function MenuDemo() {
  const [wrap, setWrap] = useState(true);
  const [density, setDensity] = useState('comfortable');
  return (
    <Menu.Root>
      <Menu.Trigger class="docs-menu-trigger">Actions</Menu.Trigger>
      <Menu.Positioner class="docs-menu-positioner">
        <Menu.Popup class="docs-menu" aria-label="Actions">
          <Menu.Item class="docs-menu__item">New file</Menu.Item>
          <Menu.Item class="docs-menu__item">New window</Menu.Item>
          <Menu.Item class="docs-menu__item" disabled>
            Open recent
          </Menu.Item>
          <Menu.Separator class="docs-menu__separator" />
          <Menu.CheckboxItem
            class="docs-menu__item"
            checked={wrap}
            onCheckedChange={setWrap}
          >
            <span class="docs-menu__check" aria-hidden="true">
              {wrap ? '✓' : ''}
            </span>
            Word wrap
          </Menu.CheckboxItem>
          <Menu.Separator class="docs-menu__separator" />
          <Menu.Group class="docs-menu__group">
            <Menu.GroupLabel class="docs-menu__label">Density</Menu.GroupLabel>
            <Menu.RadioGroup value={density} onValueChange={setDensity}>
              <Menu.RadioItem class="docs-menu__item" value="comfortable">
                <span class="docs-menu__check" aria-hidden="true">
                  {density === 'comfortable' ? '●' : ''}
                </span>
                Comfortable
              </Menu.RadioItem>
              <Menu.RadioItem class="docs-menu__item" value="compact">
                <span class="docs-menu__check" aria-hidden="true">
                  {density === 'compact' ? '●' : ''}
                </span>
                Compact
              </Menu.RadioItem>
            </Menu.RadioGroup>
          </Menu.Group>
          <Menu.Separator class="docs-menu__separator" />
          <Menu.SubmenuRoot>
            <Menu.SubmenuTrigger class="docs-menu__item docs-menu__subtrigger">
              Share
              <span class="docs-menu__chevron" aria-hidden="true">
                {'›'}
              </span>
            </Menu.SubmenuTrigger>
            <Menu.SubmenuPositioner class="docs-menu-positioner">
              <Menu.SubmenuPopup class="docs-menu" aria-label="Share">
                <Menu.Item class="docs-menu__item">Copy link</Menu.Item>
                <Menu.Item class="docs-menu__item">Email</Menu.Item>
                <Menu.Item class="docs-menu__item">Export PDF</Menu.Item>
              </Menu.SubmenuPopup>
            </Menu.SubmenuPositioner>
          </Menu.SubmenuRoot>
        </Menu.Popup>
      </Menu.Positioner>
    </Menu.Root>
  );
}
