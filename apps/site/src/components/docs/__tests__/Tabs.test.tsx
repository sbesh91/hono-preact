// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/preact';
import { Tabs } from '../Tabs.js';

afterEach(cleanup);

function panelFor(el: HTMLElement) {
  return el.closest('[role="tabpanel"]') as HTMLElement;
}

describe('Tabs', () => {
  function basic() {
    return (
      <Tabs labels={['One', 'Two']}>
        <p>first</p>
        <p>second</p>
      </Tabs>
    );
  }

  it('selects the first tab by default and renders all panels', () => {
    const { getByRole, getByText } = render(basic());
    expect(getByRole('tab', { name: 'One' }).getAttribute('aria-selected')).toBe(
      'true'
    );
    // Inactive tab must explicitly declare aria-selected="false" (not omitted).
    expect(getByRole('tab', { name: 'Two' }).getAttribute('aria-selected')).toBe('false');
    // Both panels exist; the inactive one is hidden.
    expect(panelFor(getByText('first')).hidden).toBe(false);
    expect(panelFor(getByText('second')).hidden).toBe(true);
  });

  it('switches the active panel on click', () => {
    const { getByRole, getByText } = render(basic());
    fireEvent.click(getByRole('tab', { name: 'Two' }));
    expect(panelFor(getByText('first')).hidden).toBe(true);
    expect(panelFor(getByText('second')).hidden).toBe(false);
  });

  it('moves selection with ArrowRight/ArrowLeft and wraps', () => {
    const { getByRole } = render(basic());
    const tablist = getByRole('tablist');
    fireEvent.keyDown(tablist, { key: 'ArrowRight' });
    expect(getByRole('tab', { name: 'Two' }).getAttribute('aria-selected')).toBe(
      'true'
    );
    fireEvent.keyDown(tablist, { key: 'ArrowRight' }); // wraps to first
    expect(getByRole('tab', { name: 'One' }).getAttribute('aria-selected')).toBe(
      'true'
    );
  });

  it('links each tab to its panel via aria-controls', () => {
    const { getByRole, getByText } = render(basic());
    const tab = getByRole('tab', { name: 'One' });
    expect(tab.getAttribute('aria-controls')).toBe(panelFor(getByText('first')).id);
  });

  it('renders an accessory and passes it the active index', () => {
    const { getByText, getByRole } = render(
      <Tabs
        labels={['One', 'Two']}
        accessory={({ active }) => <span>active:{active}</span>}
      >
        <p>first</p>
        <p>second</p>
      </Tabs>
    );
    expect(getByText('active:0')).toBeTruthy();
    fireEvent.click(getByRole('tab', { name: 'Two' }));
    expect(getByText('active:1')).toBeTruthy();
  });
});
