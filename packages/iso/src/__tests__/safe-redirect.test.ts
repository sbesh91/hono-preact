// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { isSameOrigin, assignSafeRedirect } from '../internal/safe-redirect.js';

describe('isSameOrigin', () => {
  it('accepts relative paths', () => {
    expect(isSameOrigin('/foo')).toBe(true);
    expect(isSameOrigin('foo/bar')).toBe(true);
  });
  it('accepts same-origin absolute URLs', () => {
    // window.location.origin in jsdom/happy-dom is typically http://localhost:3000 or http://localhost
    const sameOrigin = window.location.origin + '/foo';
    expect(isSameOrigin(sameOrigin)).toBe(true);
  });
  it('rejects cross-origin URLs', () => {
    expect(isSameOrigin('https://evil.example.com/foo')).toBe(false);
  });
  it('rejects URLs that throw during parsing', () => {
    // http://[invalid triggers an Invalid URL error in the URL constructor.
    expect(isSameOrigin('http://[invalid')).toBe(false);
  });
  it('rejects javascript: URLs (null origin)', () => {
    // javascript: URLs parse without throwing but have origin "null",
    // which does not match any real window.location.origin.
    expect(isSameOrigin('javascript:alert(1)')).toBe(false);
  });
});

describe('assignSafeRedirect', () => {
  it('refuses cross-origin and returns false', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // We can't easily mock window.location.assign without breaking jsdom,
    // so just check the boolean return for the cross-origin case.
    expect(assignSafeRedirect('https://evil.example.com/foo')).toBe(false);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('cross-origin refusal message names the same-origin fix', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    assignSafeRedirect('https://evil.example.com/foo');
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('redirect() must return a same-origin path (e.g. "/dashboard").')
    );
    errorSpy.mockRestore();
  });
});
