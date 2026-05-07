// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/preact';
import { useContext } from 'preact/hooks';
import { FragmentModeContext } from '../fragment-mode.js';

describe('FragmentModeContext', () => {
  it('defaults to false', () => {
    let observed: boolean | undefined;
    function Probe() {
      observed = useContext(FragmentModeContext);
      return null;
    }
    render(<Probe />);
    expect(observed).toBe(false);
  });

  it('reads true when wrapped in a provider with value=true', () => {
    let observed: boolean | undefined;
    function Probe() {
      observed = useContext(FragmentModeContext);
      return null;
    }
    render(
      <FragmentModeContext.Provider value={true}>
        <Probe />
      </FragmentModeContext.Provider>
    );
    expect(observed).toBe(true);
  });
});
