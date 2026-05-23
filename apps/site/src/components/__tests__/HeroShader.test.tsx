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
    // Canvas is always mounted; fallback gradient is layered on top when needed.
    expect(container.querySelector('canvas')).not.toBeNull();
  });

  it('renders the fallback gradient when WebGL2 is unavailable', () => {
    // happy-dom returns null from canvas.getContext('webgl2'), so the effect
    // takes the fallback branch and layers a gradient div on top of the canvas.
    const { container } = render(<HeroShader />);
    const wrapper = container.querySelector('[aria-hidden="true"]')!;
    // Wrapper children: canvas, fallback gradient div, fade overlay div.
    expect(wrapper.children.length).toBe(3);
  });

  it('unmounts cleanly without throwing', () => {
    const { unmount } = render(<HeroShader />);
    expect(() => unmount()).not.toThrow();
  });
});
