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
    <section class="mx-auto max-w-md p-6 space-y-4">
      <h1 class="text-2xl font-semibold">Sign in to the demo</h1>
      <p class="text-sm text-gray-700">
        This is a feature showcase. Enter any email; the demo will create that
        user and sign you in. There is no real magic link.
      </p>
      <Form action={serverActions.login} class="space-y-3">
        <label class="block">
          <span class="text-sm">Email</span>
          <input
            name="email"
            type="email"
            required
            class="block w-full border px-2 py-1 mt-1"
            placeholder="you@example.com"
          />
        </label>
        <label class="block">
          <span class="text-sm">Display name (optional)</span>
          <input
            name="name"
            type="text"
            class="block w-full border px-2 py-1 mt-1"
          />
        </label>
        <button
          type="submit"
          class="bg-blue-600 text-white px-3 py-1"
          onClick={markAuthed}
        >
          {pending ? 'Signing in...' : 'Sign in'}
        </button>
        {error && <p class="text-sm text-red-700">{error}</p>}
      </Form>
    </section>
  );
};
LoginPage.displayName = 'LoginPage';

export default definePage(LoginPage, {});
