import { definePage, Form, useFormStatus, useActionResult } from 'hono-preact';
import type { FunctionComponent } from 'preact';
import { serverActions } from './login.server.js';
import { DEMO_AUTHED_KEY } from '../../demo/guard.js';

const LoginPage: FunctionComponent = () => {
  const { pending } = useFormStatus(serverActions.login);
  const result = useActionResult(serverActions.login);
  const error =
    result?.kind === 'deny' || result?.kind === 'error' ? result.message : null;

  // Set the client-guard flag as the sign-in is submitted, before the action's
  // redirect triggers a full reload to /demo/projects. Without this, the client
  // guard runs during that page's hydration before projects.tsx's bootstrap
  // useEffect, sees no flag, and bounces back to /demo/login. A stale flag from
  // a failed sign-in is harmless: the server guard rejects on the next request.
  const markAuthed = () => {
    try {
      window.localStorage.setItem(DEMO_AUTHED_KEY, '1');
    } catch {
      // ignore: server guard remains the source of truth on full reloads.
    }
  };

  return (
    <div class="grid min-h-screen place-items-center bg-background px-4">
      <div class="w-full max-w-sm rounded-2xl border border-border bg-surface-subtle p-8 shadow-sm">
        <div class="mb-6">
          <div class="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-magenta-500 to-brand-orange">
            <span class="text-lg font-bold text-white">T</span>
          </div>
          <h1 class="text-xl font-bold text-foreground">Sign in to Tasks</h1>
          <p class="mt-1 text-sm text-muted">
            This is a feature showcase. Enter any email; the demo will create
            that user and sign you in. There is no real magic link.
          </p>
        </div>
        <Form action={serverActions.login} class="space-y-4">
          <label class="block">
            <span class="mb-1.5 block text-sm font-medium text-foreground">
              Email
            </span>
            <input
              name="email"
              type="email"
              required
              class="block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
              placeholder="you@example.com"
            />
          </label>
          <label class="block">
            <span class="mb-1.5 block text-sm font-medium text-foreground">
              Display name{' '}
              <span class="font-normal text-muted">(optional)</span>
            </span>
            <input
              name="name"
              type="text"
              class="block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
              placeholder="Alice"
            />
          </label>
          {error && (
            <p class="rounded-lg border border-danger/20 bg-danger/5 px-3 py-2 text-sm text-danger">
              {error}
            </p>
          )}
          <button
            type="submit"
            class="w-full rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground hover:bg-accent-hover disabled:opacity-60"
            onClick={markAuthed}
            disabled={pending}
          >
            {pending ? 'Signing in...' : 'Sign in'}
          </button>
        </Form>
      </div>
    </div>
  );
};
LoginPage.displayName = 'LoginPage';

export default definePage(LoginPage, {});
