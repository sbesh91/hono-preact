// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, act, cleanup } from '@testing-library/preact';
import { useAnnouncer, ToastAnnouncer } from '../toast/announcer.js';

afterEach(cleanup);

function Harness() {
  const a = useAnnouncer();
  return (
    <div>
      <button onClick={() => a.announce('Polite hello', false)}>polite</button>
      <button onClick={() => a.announce('Urgent hello', true)}>urgent</button>
      <ToastAnnouncer politeRef={a.politeRef} assertiveRef={a.assertiveRef} />
    </div>
  );
}

describe('ToastAnnouncer', () => {
  it('pre-mounts both live regions empty before any announcement', () => {
    const { getByRole } = render(<Harness />);
    const status = getByRole('status');
    const alert = getByRole('alert');
    expect(status.getAttribute('aria-live')).toBe('polite');
    expect(alert.getAttribute('aria-live')).toBe('assertive');
    expect(status.getAttribute('aria-atomic')).toBe('true');
    expect(status.textContent).toBe('');
    expect(alert.textContent).toBe('');
  });

  it('routes polite vs assertive by importance', () => {
    vi.useFakeTimers();
    const { getByText, getByRole } = render(<Harness />);
    act(() => getByText('polite').click());
    expect(getByRole('status').textContent).toBe('Polite hello');
    expect(getByRole('alert').textContent).toBe('');
    act(() => getByText('urgent').click());
    expect(getByRole('alert').textContent).toBe('Urgent hello');
    vi.useRealTimers();
  });

  it('clears the region after the clear delay so a repeat re-announces', () => {
    vi.useFakeTimers();
    const { getByText, getByRole } = render(<Harness />);
    act(() => getByText('polite').click());
    expect(getByRole('status').textContent).toBe('Polite hello');
    act(() => vi.advanceTimersByTime(1000));
    expect(getByRole('status').textContent).toBe('');
    vi.useRealTimers();
  });
});
