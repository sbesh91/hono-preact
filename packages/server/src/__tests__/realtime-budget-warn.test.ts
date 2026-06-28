import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  warnIfOverForwardBudget,
  MAX_FORWARD_HEADER_BYTES,
} from '../realtime-budget.js';

afterEach(() => vi.restoreAllMocks());

describe('warnIfOverForwardBudget', () => {
  it('warns in dev when the JSON-serialized data exceeds the budget', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const big = { blob: 'x'.repeat(MAX_FORWARD_HEADER_BYTES + 1) };
    warnIfOverForwardBudget(big, true, 'socket');
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]![0]).toContain('forward limit');
  });

  it('does not warn when under budget', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    warnIfOverForwardBudget({ ok: true }, true, 'room');
    expect(warn).not.toHaveBeenCalled();
  });

  it('does not warn when dev is false, even over budget', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const big = { blob: 'x'.repeat(MAX_FORWARD_HEADER_BYTES + 1) };
    warnIfOverForwardBudget(big, false, 'socket');
    expect(warn).not.toHaveBeenCalled();
  });

  it('does not warn when data is undefined (factory-less)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    warnIfOverForwardBudget(undefined, true, 'socket');
    expect(warn).not.toHaveBeenCalled();
  });
});
