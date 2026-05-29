// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/preact';
import { useRef } from 'preact/hooks';
import {
  useViewTransitionName,
  useViewTransitionClass,
} from '../view-transition-name.js';

function Probe({ name }: { name: string | null }) {
  const ref = useViewTransitionName(name);
  return <article ref={ref} />;
}

function ProbeClass({ cls }: { cls: string | string[] | null }) {
  const ref = useViewTransitionClass(cls);
  return <article ref={ref} />;
}

describe('useViewTransitionName', () => {
  it('writes view-transition-name to the live DOM node', () => {
    const { container } = render(<Probe name="hero" />);
    const el = container.firstElementChild as HTMLElement;
    expect(el.style.getPropertyValue('view-transition-name')).toBe('hero');
  });

  it('updates when name changes', () => {
    const { container, rerender } = render(<Probe name="hero" />);
    const el = container.firstElementChild as HTMLElement;
    rerender(<Probe name="hero-2" />);
    expect(el.style.getPropertyValue('view-transition-name')).toBe('hero-2');
  });

  it('clears when name becomes null', () => {
    const { container, rerender } = render(<Probe name="hero" />);
    const el = container.firstElementChild as HTMLElement;
    rerender(<Probe name={null} />);
    expect(el.style.getPropertyValue('view-transition-name')).toBe('');
  });

  it('composes with a consumer ref', () => {
    function Compose() {
      const consumerRef = useRef<HTMLElement | null>(null);
      const vtRef = useViewTransitionName('hero');
      return (
        <article
          ref={(node) => {
            consumerRef.current = node;
            vtRef(node);
          }}
        />
      );
    }
    const { container } = render(<Compose />);
    const el = container.firstElementChild as HTMLElement;
    expect(el.style.getPropertyValue('view-transition-name')).toBe('hero');
  });
});

describe('useViewTransitionClass', () => {
  it('writes view-transition-class as a single string', () => {
    const { container } = render(<ProbeClass cls="card" />);
    const el = container.firstElementChild as HTMLElement;
    expect(el.style.getPropertyValue('view-transition-class')).toBe('card');
  });

  it('joins an array with spaces', () => {
    const { container } = render(<ProbeClass cls={['card', 'highlight']} />);
    const el = container.firstElementChild as HTMLElement;
    expect(el.style.getPropertyValue('view-transition-class')).toBe(
      'card highlight'
    );
  });

  it('clears when null', () => {
    const { container, rerender } = render(<ProbeClass cls="card" />);
    const el = container.firstElementChild as HTMLElement;
    rerender(<ProbeClass cls={null} />);
    expect(el.style.getPropertyValue('view-transition-class')).toBe('');
  });
});
