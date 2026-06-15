// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { Combobox, ComboboxRoot } from '../index.js';
import * as ui from '../index.js';

describe('hono-preact-ui exports', () => {
  it('exposes the new machinery primitives', () => {
    expect(typeof ui.usePosition).toBe('function');
    expect(typeof ui.useDismiss).toBe('function');
    expect(typeof ui.useFocusReturn).toBe('function');
    expect(typeof ui.useSafeArea).toBe('function');
    expect(typeof ui.placementFor).toBe('function');
  });

  it('exposes the Menu namespace', () => {
    expect(typeof ui.Menu.Root).toBe('function');
    expect(typeof ui.Menu.Item).toBe('function');
    expect(typeof ui.Menu.CheckboxItem).toBe('function');
    expect(typeof ui.Menu.SubmenuTrigger).toBe('function');
  });

  it('exposes the ContextMenu namespace', () => {
    expect(typeof ui.ContextMenu.Root).toBe('function');
    expect(typeof ui.ContextMenu.Trigger).toBe('function');
    expect(typeof ui.ContextMenu.Item).toBe('function');
  });

  it('exposes the list-navigation primitive but not its internal helpers', () => {
    expect(typeof ui.useListNavigation).toBe('function');
    expect(typeof ui.useTypeahead).toBe('function');
    // The granular helpers are internal implementation details, not public API.
    expect('getItems' in ui).toBe(false);
    expect('wrapNext' in ui).toBe(false);
    expect('wrapPrev' in ui).toBe(false);
    expect('matchTypeahead' in ui).toBe(false);
    expect('OPTION_SELECTOR' in ui).toBe(false);
  });

  it('keeps matchSubstring public (used by the Combobox filter demos)', () => {
    expect(typeof ui.matchSubstring).toBe('function');
  });

  it('exposes the Select namespace', () => {
    expect(typeof ui.Select.Root).toBe('function');
    expect(typeof ui.Select.Trigger).toBe('function');
    expect(typeof ui.Select.Option).toBe('function');
    expect(typeof ui.Select.Value).toBe('function');
  });

  it('exposes the promoted composition hooks', () => {
    expect(typeof ui.usePositioner).toBe('function');
    expect(typeof ui.useListboxSelection).toBe('function');
  });
});

describe('Combobox exports', () => {
  it('exposes the Combobox namespace with all parts', () => {
    expect(typeof ComboboxRoot).toBe('function');
    for (const part of [
      'Root',
      'Input',
      'Trigger',
      'Clear',
      'Anchor',
      'Positioner',
      'Popup',
      'Empty',
      'Option',
      'OptionGroup',
      'OptionGroupLabel',
      'Arrow',
      'Status',
      'Value',
    ]) {
      expect(typeof (Combobox as Record<string, unknown>)[part]).toBe(
        'function'
      );
    }
  });
});
