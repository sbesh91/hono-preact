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
  const tabs = [
    { label: 'CSS', code: '.a { color: red; }', language: 'css' },
    { label: 'Tailwind', code: '<div class="text-red-500" />', language: 'html' },
  ];

  it('shows the first tab by default and switches on click', () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn() },
      configurable: true,
    });
    const { getByRole, getByText, queryByText } = render(
      <CodeTabs tabs={tabs} />
    );
    expect(getByText('.a { color: red; }')).toBeTruthy();
    expect(queryByText('<div class="text-red-500" />')).toBeNull();

    fireEvent.click(getByRole('tab', { name: 'Tailwind' }));
    expect(getByText('<div class="text-red-500" />')).toBeTruthy();
  });

  it('renders a Copy button for the active tab', () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn() },
      configurable: true,
    });
    const { getAllByRole } = render(<CodeTabs tabs={tabs} />);
    const copy = getAllByRole('button').find((b) => b.textContent === 'Copy');
    expect(copy).toBeTruthy();
  });
});
