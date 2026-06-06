// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import {
  MenuRoot,
  MenuTrigger,
  MenuPositioner,
  MenuPopup,
  MenuItem,
} from '../menu/menu.js';

describe('Menu SSR', () => {
  it('renders the trigger and omits the closed surface on the server', () => {
    const html = renderToString(
      <MenuRoot>
        <MenuTrigger>Open</MenuTrigger>
        <MenuPositioner>
          <MenuPopup>
            <MenuItem>Cut</MenuItem>
          </MenuPopup>
        </MenuPositioner>
      </MenuRoot>
    );
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).not.toContain('role="menu"');
  });
});
