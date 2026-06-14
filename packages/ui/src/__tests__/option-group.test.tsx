// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/preact';
import { OptionGroup, OptionGroupLabel } from '../option-group.js';

afterEach(cleanup);

describe('OptionGroup', () => {
  it("wires the label id to the group's aria-labelledby", () => {
    const { container } = render(
      <OptionGroup data-testid="group">
        <OptionGroupLabel data-testid="label">Citrus</OptionGroupLabel>
      </OptionGroup>
    );
    const group = container.querySelector(
      '[data-testid="group"]'
    ) as HTMLElement;
    const label = container.querySelector(
      '[data-testid="label"]'
    ) as HTMLElement;
    expect(group.getAttribute('role')).toBe('group');
    const labelledby = group.getAttribute('aria-labelledby');
    expect(labelledby).toBeTruthy();
    expect(label.id).toBe(labelledby);
  });

  it('a label outside any group gets no id', () => {
    const { container } = render(
      <OptionGroupLabel data-testid="label">X</OptionGroupLabel>
    );
    const label = container.querySelector(
      '[data-testid="label"]'
    ) as HTMLElement;
    expect(label.id).toBe('');
  });
});
