import * as v from 'valibot';

// The login form posts FormData, so both fields arrive as strings. The
// schema normalizes shape (trim, lowercase, default name); the email format
// check lives in the action as a deny(400, ...) so the demo shows the deny
// idiom for an intentional denial.
export const LoginSchema = v.object({
  email: v.pipe(v.string(), v.trim(), v.toLowerCase()),
  name: v.fallback(v.pipe(v.string(), v.trim()), ''),
});
