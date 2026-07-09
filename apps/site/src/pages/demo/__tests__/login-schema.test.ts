import { describe, expect, it } from 'vitest';
import * as v from 'valibot';
import { LoginSchema } from '../login-schema.js';

describe('LoginSchema', () => {
  it('trims and lowercases the email', () => {
    const r = v.parse(LoginSchema, {
      email: '  Alice@Example.COM ',
      name: '',
    });
    expect(r.email).toBe('alice@example.com');
  });

  it('defaults a missing name to the empty string', () => {
    const r = v.parse(LoginSchema, { email: 'a@b.co' });
    expect(r.name).toBe('');
  });

  it('rejects a non-string email', () => {
    const r = v.safeParse(LoginSchema, { email: 42 });
    expect(r.success).toBe(false);
  });
});
