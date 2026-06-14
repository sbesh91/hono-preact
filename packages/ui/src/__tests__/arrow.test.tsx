// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/preact';
import { useRef } from 'preact/hooks';
import { h } from 'preact';
import { Arrow } from '../arrow.js';
import { PositionerContext } from '../positioner-context.js';
import type { PositionState } from '../use-position.js';

afterEach(cleanup);

function withPosition(position: PositionState, child: preact.VNode) {
  function Wrapper() {
    const arrowRef = useRef<HTMLElement>(null);
    return h(
      PositionerContext.Provider,
      { value: { position, arrowRef } },
      child
    );
  }
  return <Wrapper />;
}

describe('Arrow', () => {
  it('renders data-side and the absolute offset from the provided position', () => {
    const { container } = render(
      withPosition(
        { side: 'right', align: 'center', arrowX: 12, arrowY: 34 },
        <Arrow data-testid="arrow" />
      )
    );
    const el = container.querySelector('[data-testid="arrow"]') as HTMLElement;
    expect(el.getAttribute('data-side')).toBe('right');
    expect(el.style.position).toBe('absolute');
    expect(el.style.left).toBe('12px');
    expect(el.style.top).toBe('34px');
  });

  it('omits left/top when arrowX/arrowY are null', () => {
    const { container } = render(
      withPosition(
        { side: 'top', align: 'center', arrowX: null, arrowY: null },
        <Arrow data-testid="arrow" />
      )
    );
    const el = container.querySelector('[data-testid="arrow"]') as HTMLElement;
    expect(el.style.left).toBe('');
    expect(el.style.top).toBe('');
  });

  it('throws when rendered outside a Positioner', () => {
    expect(() => render(<Arrow />)).toThrow(
      '<Arrow> must be rendered inside a Positioner'
    );
  });

  it('reads the nearest Positioner when providers are nested (submenu case)', () => {
    function Nested() {
      const outerRef = useRef<HTMLElement>(null);
      const innerRef = useRef<HTMLElement>(null);
      return h(
        PositionerContext.Provider,
        {
          value: {
            position: {
              side: 'top',
              align: 'center',
              arrowX: null,
              arrowY: null,
            },
            arrowRef: outerRef,
          },
        },
        h(
          PositionerContext.Provider,
          {
            value: {
              position: {
                side: 'left',
                align: 'center',
                arrowX: null,
                arrowY: null,
              },
              arrowRef: innerRef,
            },
          },
          <Arrow data-testid="inner-arrow" />
        )
      );
    }
    const { container } = render(<Nested />);
    const el = container.querySelector(
      '[data-testid="inner-arrow"]'
    ) as HTMLElement;
    expect(el.getAttribute('data-side')).toBe('left');
  });
});
