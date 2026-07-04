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

  it('warns (not throws) when the data is not JSON-serializable (circular reference)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const c: any = {};
    c.self = c;
    expect(() => warnIfOverForwardBudget(c, true, 'socket')).not.toThrow();
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]![0]).toMatch(/not JSON-serializable|Cloudflare/i);
  });

  // Cloudflare budgets a room's key `params` independently of its `data`
  // (cf/realtime-do-glue.ts), so the Node dev warn must cover an over-budget
  // params payload too, not only the data-factory result.
  it('warns when a room params payload exceeds the budget (params are budgeted on CF too)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const bigParams = { roomId: 'x'.repeat(MAX_FORWARD_HEADER_BYTES + 1) };
    warnIfOverForwardBudget(undefined, true, 'room', bigParams);
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]![0]).toContain('params');
    expect(warn.mock.calls[0]![0]).toContain('forward limit');
  });

  it('does not budget params on the socket path (sockets carry no params)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const bigParams = { x: 'y'.repeat(MAX_FORWARD_HEADER_BYTES + 1) };
    warnIfOverForwardBudget(undefined, true, 'socket', bigParams);
    expect(warn).not.toHaveBeenCalled();
  });

  it('warns for both an over-budget room params and an over-budget data segment', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const big = 'z'.repeat(MAX_FORWARD_HEADER_BYTES + 1);
    warnIfOverForwardBudget({ blob: big }, true, 'room', { roomId: big });
    expect(warn).toHaveBeenCalledTimes(2);
  });
});
