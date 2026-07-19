// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { cleanup, render } from '@testing-library/preact';
import { useRef } from 'preact/hooks';
import {
  useViewTransitionName,
  useViewTransitionClass,
} from '../view-transition-name.js';

let warnSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  // Silence and capture the dev inert-class warning. Several probes below
  // attach a class to a nameless element, which legitimately warns; a blanket
  // silent spy keeps that expected noise out of the reporter while letting the
  // dedicated tests assert on the call count.
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

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

describe('useViewTransitionClass dev warning', () => {
  it('warns once when a class attaches to an element with no view-transition-name', () => {
    render(<ProbeClass cls="board-column" />);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const msg = String(warnSpy.mock.calls[0]?.[0]);
    expect(msg).toContain('board-column');
    expect(msg).toContain('view-transition-name');
  });

  it('does not warn when the element already carries its own view-transition-name', () => {
    // happy-dom's getComputedStyle does not resolve view-transition-name from a
    // stylesheet, so the element's own name is set as an inline style here to
    // exercise the present-name branch (stands in for an element that has a
    // name of its own, e.g. from CSS, in a real browser).
    function ProbeNamedClass() {
      const classRef = useViewTransitionClass('board-column');
      return (
        <article
          ref={(node) => {
            if (node) node.style.setProperty('view-transition-name', 'named');
            classRef(node);
          }}
        />
      );
    }
    render(<ProbeNamedClass />);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('does not warn when the class value is null', () => {
    render(<ProbeClass cls={null} />);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('does not warn when the class value is an empty string', () => {
    // An empty class applies nothing (removeProperty, same as null), so it is
    // never inert and must not warn even on a nameless element.
    render(<ProbeClass cls="" />);
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
