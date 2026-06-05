export {
  ContextMenuRoot,
  ContextMenuTrigger,
  type ContextMenuRootProps,
  type ContextMenuTriggerProps,
} from './context-menu.js';

import { ContextMenuRoot, ContextMenuTrigger } from './context-menu.js';
import {
  MenuPositioner,
  MenuPopup,
  MenuItem,
  MenuCheckboxItem,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuGroup,
  MenuGroupLabel,
  MenuArrow,
} from '../menu/menu.js';
import {
  SubmenuRoot,
  SubmenuTrigger,
  SubmenuPositioner,
  SubmenuPopup,
} from '../menu/submenu.js';

// Same underlying parts as Menu, under ContextMenu names so examples stay
// self-consistent (never mix Menu.Item inside ContextMenu.Root).
export const ContextMenu = {
  Root: ContextMenuRoot,
  Trigger: ContextMenuTrigger,
  Positioner: MenuPositioner,
  Popup: MenuPopup,
  Item: MenuItem,
  CheckboxItem: MenuCheckboxItem,
  RadioGroup: MenuRadioGroup,
  RadioItem: MenuRadioItem,
  Separator: MenuSeparator,
  Group: MenuGroup,
  GroupLabel: MenuGroupLabel,
  Arrow: MenuArrow,
  SubmenuRoot,
  SubmenuTrigger,
  SubmenuPositioner,
  SubmenuPopup,
};
