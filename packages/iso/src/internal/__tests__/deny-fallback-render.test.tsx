// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/preact';
import { renderDenyFallback } from '../loader.js';
import { LoaderIdContext } from '../contexts.js';

// Finding 5: the deny-fallback render+wrap (errorFallback dispatch, wrapped in
// an Envelope carrying the 'deny' anchor) is duplicated between the server
// `DataReader` catch and the client `LoaderHost` `fromBakedDeny` branch. A
// single shared helper keeps them in lockstep so a future edit to one can't
// silently diverge from the other and produce a hydration mismatch.
//
// `<Envelope>` requires a `LoaderIdContext` ancestor (it throws otherwise), so
// every render below wraps the helper's output in a provider, mirroring how
// both real call sites are always rendered under `LoaderHost`.
describe('renderDenyFallback', () => {
  it('wraps a static (non-function) errorFallback in a data-loader-deny Envelope', () => {
    const { container } = render(
      <LoaderIdContext.Provider value="test-id">
        {renderDenyFallback(
          <p class="fb">static</p>,
          new Error('gone'),
          () => {},
          'gone'
        )}
      </LoaderIdContext.Provider>
    );
    const wrapper = container.querySelector('[data-loader-deny]');
    expect(wrapper).toBeTruthy();
    expect(wrapper?.querySelector('.fb')?.textContent).toBe('static');
  });

  it('invokes a function errorFallback with (error, reset) and wraps the result', () => {
    let seenError: Error | null = null;
    let seenReset: (() => void) | null = null;
    const reset = () => {};
    const { container } = render(
      <LoaderIdContext.Provider value="test-id">
        {renderDenyFallback(
          (e: Error, r: () => void) => {
            seenError = e;
            seenReset = r;
            return <p class="fb">{e.message}</p>;
          },
          new Error('gone'),
          reset,
          'gone'
        )}
      </LoaderIdContext.Provider>
    );
    expect(seenError).toBeInstanceOf(Error);
    expect((seenError as unknown as Error).message).toBe('gone');
    expect(seenReset).toBe(reset);
    const wrapper = container.querySelector('[data-loader-deny]');
    expect(wrapper).toBeTruthy();
    expect(wrapper?.querySelector('.fb')?.textContent).toBe('gone');
  });
});
