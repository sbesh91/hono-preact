import { ContextMenu } from '@hono-preact/ui';

// A right-click (contextmenu) menu. The Trigger is the drop zone; right-click
// inside it to open the menu at the pointer. The part set below is identical to
// Menu. Styling is in root.css (.docs-menu* / .docs-context-zone).
export function ContextMenuDemo() {
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger class="docs-context-zone">
        Right-click here
      </ContextMenu.Trigger>
      <ContextMenu.Positioner class="docs-menu-positioner">
        <ContextMenu.Popup class="docs-menu" aria-label="Canvas">
          <ContextMenu.Item class="docs-menu__item">Cut</ContextMenu.Item>
          <ContextMenu.Item class="docs-menu__item">Copy</ContextMenu.Item>
          <ContextMenu.Item class="docs-menu__item">Paste</ContextMenu.Item>
          <ContextMenu.Separator class="docs-menu__separator" />
          <ContextMenu.Item class="docs-menu__item" disabled>
            Undo
          </ContextMenu.Item>
          <ContextMenu.Item class="docs-menu__item">
            Select all
          </ContextMenu.Item>
        </ContextMenu.Popup>
      </ContextMenu.Positioner>
    </ContextMenu.Root>
  );
}
