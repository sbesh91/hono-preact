// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/preact';
import { Example } from '../Example.js';
import { CodeTabs } from '../CodeTabs.js';

afterEach(cleanup);

describe('Example', () => {
  it('renders children inside a bordered frame', () => {
    const { getByText, container } = render(
      <Example>
        <span>demo</span>
      </Example>
    );
    expect(getByText('demo')).toBeTruthy();
    expect(container.querySelector('.docs-example')).toBeTruthy();
  });
});

describe('CodeTabs', () => {
  // In the docs these children are fenced code blocks (highlighted by Shiki at
  // build time); in tests we stand in plain <pre> blocks.
  function tabs() {
    return (
      <CodeTabs labels={['CSS', 'Tailwind']}>
        <pre>css-code</pre>
        <pre>tailwind-code</pre>
      </CodeTabs>
    );
  }

  it('shows the first block by default and switches on click', () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn() },
      configurable: true,
    });
    const { getByRole, getByText } = render(tabs());
    const cssPanel = getByText('css-code').closest('[role="tabpanel"]') as HTMLElement;
    const twPanel = getByText('tailwind-code').closest(
      '[role="tabpanel"]'
    ) as HTMLElement;
    expect(cssPanel.hidden).toBe(false);
    expect(twPanel.hidden).toBe(true);

    fireEvent.click(getByRole('tab', { name: 'Tailwind' }));
    expect(cssPanel.hidden).toBe(true);
    expect(twPanel.hidden).toBe(false);
  });

  it('copies the active block text via the Copy button', () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    const { getByText } = render(tabs());
    fireEvent.click(getByText('Copy'));
    expect(writeText).toHaveBeenCalledWith('css-code');
  });
});
