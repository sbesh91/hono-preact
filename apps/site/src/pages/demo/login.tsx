import { definePage, Form, useAction } from 'hono-preact';
import type { FunctionComponent } from 'preact';
import { useState } from 'preact/hooks';
import { serverActions } from './login.server.js';

const LoginPage: FunctionComponent = () => {
  const [error, setError] = useState<string | null>(null);
  const { mutate, pending } = useAction(serverActions.login, {
    onSuccess: () => {
      setError(null);
      window.location.assign('/demo/projects');
    },
    onError: (e) => setError(e.message),
  });

  return (
    <section class="mx-auto max-w-md p-6 space-y-4">
      <h1 class="text-2xl font-semibold">Sign in to the demo</h1>
      <p class="text-sm text-gray-700">
        This is a feature showcase. Enter any email; the demo will create that
        user and sign you in. There is no real magic link.
      </p>
      <Form
        mutate={mutate}
        pending={pending}
        class="space-y-3"
      >
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
        <button type="submit" class="bg-blue-600 text-white px-3 py-1">
          {pending ? 'Signing in...' : 'Sign in'}
        </button>
        {error && <p class="text-sm text-red-700">{error}</p>}
      </Form>
    </section>
  );
};
LoginPage.displayName = 'LoginPage';

export default definePage(LoginPage, {});
