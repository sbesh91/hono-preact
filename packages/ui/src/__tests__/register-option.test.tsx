// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/preact';
import { useRegisterOption } from '../listbox/selection.js';

afterEach(cleanup);

describe('useRegisterOption', () => {
  it('registers the string label on mount and deregisters on unmount', () => {
    const deregister = vi.fn();
    const register = vi.fn(() => deregister);
    function Opt() {
      useRegisterOption(register, 'id1', 'v1', 'Label 1');
      return <div />;
    }
    const { unmount } = render(<Opt />);
    expect(register).toHaveBeenCalledWith('id1', 'v1', 'Label 1');
    expect(deregister).not.toHaveBeenCalled();
    unmount();
    expect(deregister).toHaveBeenCalledTimes(1);
  });

  it('falls back to the element text content when stringLabel is undefined', () => {
    const register = vi.fn(() => () => {});
    function Opt() {
      useRegisterOption(register, 'id1', 'v1', undefined);
      return <div id="id1">From DOM</div>;
    }
    render(<Opt />);
    expect(register).toHaveBeenCalledWith('id1', 'v1', 'From DOM');
  });

  it('re-registers when the label changes', () => {
    const register = vi.fn(() => () => {});
    function Opt(props: { label: string }) {
      useRegisterOption(register, 'id1', 'v1', props.label);
      return <div />;
    }
    const { rerender } = render(<Opt label="A" />);
    expect(register).toHaveBeenLastCalledWith('id1', 'v1', 'A');
    rerender(<Opt label="B" />);
    expect(register).toHaveBeenLastCalledWith('id1', 'v1', 'B');
  });
});
