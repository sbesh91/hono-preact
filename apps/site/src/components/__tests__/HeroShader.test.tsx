// @vitest-environment happy-dom
import { afterEach, describe, it, expect } from 'vitest';
import { cleanup, render } from '@testing-library/preact';
import { HeroShader } from '../HeroShader.js';

afterEach(() => cleanup());

describe('HeroShader', () => {
  it('renders an aria-hidden background wrapper', () => {
    const { container } = render(<HeroShader />);
    const wrapper = container.querySelector('[aria-hidden="true"]');
    expect(wrapper).not.toBeNull();
  });

  it('renders a canvas element on initial mount', () => {
    const { container } = render(<HeroShader />);
    // Initial SSR/first-render path renders the canvas; the effect may swap to a
    // fallback div after mount if WebGL2 isn't available.
    expect(container.querySelector('canvas')).not.toBeNull();
  });

  it('unmounts cleanly without throwing', () => {
    const { unmount } = render(<HeroShader />);
    expect(() => unmount()).not.toThrow();
  });
});
