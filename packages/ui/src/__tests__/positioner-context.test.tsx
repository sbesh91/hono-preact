// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/preact';
import { useRef } from 'preact/hooks';
import { h } from 'preact';
import {
  PositionerContext,
  usePositionerContext,
} from '../positioner-context.js';

afterEach(cleanup);

function Consumer() {
  const { position } = usePositionerContext();
  return <span data-testid="side">{position.side}</span>;
}

describe('usePositionerContext', () => {
  it('returns the provided value inside a provider', () => {
    function Wrapper() {
      const arrowRef = useRef<HTMLElement>(null);
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
            arrowRef,
          },
        },
        <Consumer />
      );
    }
    const { getByTestId } = render(<Wrapper />);
    expect(getByTestId('side').textContent).toBe('top');
  });

  it('throws when used outside a provider', () => {
    expect(() => render(<Consumer />)).toThrow(
      '<Arrow> must be rendered inside a Positioner'
    );
  });
});
