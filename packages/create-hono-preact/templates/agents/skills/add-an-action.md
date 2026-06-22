# Add an action and form

**Use this when:** the page submits a form or performs a mutation (create, update, delete).

## Mental model (read first)

- Mutations are `defineAction`s in the colocated `*.server.ts`, not ad-hoc POST handlers.
- A `<Form>` submits to the action and works without JavaScript (progressive enhancement);
  client JS enhances it but is not required for it to function.
- The action returns a value on success and throws `redirect(...)` or `deny(...)` to end
  the request otherwise. The result reaches the component through a uniform envelope you
  read with `useActionResult()`; pending state comes from `useFormStatus()`.

## Steps

1. Add the action to `src/pages/<name>.server.ts` alongside any loaders:

   ```ts
   import { defineAction, redirect } from 'hono-preact';

   export const serverActions = {
     default: defineAction<{ email: string }, { ok: true }>(async (ctx, input) => {
       const email = (input.email ?? '').trim().toLowerCase();
       if (!email.includes('@')) throw new Error('a valid email is required');
       // ...persist using ctx.c...
       return { ok: true };
       // or end the request instead: throw redirect('/thanks');
     }),
   };
   ```

   The action receives `(ctx, payload)`: `ctx` is `{ c, signal }` and `payload` is the
   parsed form body. To refuse, throw `deny(403, 'message')` (import `deny` from
   `hono-preact`).

2. Ensure the route has its `server:` import in `src/routes.ts` (see `add-a-loader.md`,
   step 2).

3. Render a `<Form>` wired to the action, reading its status and result, in
   `src/pages/<name>.tsx`:

   ```tsx
   import { Form, useActionResult, useFormStatus } from 'hono-preact';
   import { serverActions } from './signup.server.js';

   const action = serverActions.default;

   export function SignupForm() {
     const { pending } = useFormStatus(action);
     const result = useActionResult(action);
     const error =
       result?.kind === 'deny' || result?.kind === 'error' ? result.message : null;

     return (
       <Form action={action}>
         <input name="email" type="email" required />
         {error && <p role="alert">{error}</p>}
         <button type="submit" disabled={pending}>
           {pending ? 'Submitting...' : 'Submit'}
         </button>
       </Form>
     );
   }
   ```

   To refetch a loader after a successful mutation, pass
   `invalidate={[serverLoaders.default]}` to `<Form>`.

## Verify

- Run `pnpm typecheck`.
- Run `pnpm dev`, submit the form, and confirm both the success path and an invalid
  submission (the `error` branch) behave.
- Disable JavaScript and submit again: the form still works. This proves progressive
  enhancement.

## Common mistakes

- Hand-rolling a POST route instead of `defineAction`. You lose the typed payload, the
  envelope, and progressive enhancement.
- Reading a raw `Response`. Read the outcome via `useActionResult()`; its `kind` is
  `'success' | 'deny' | 'error'`.
- Relying on client JS for the form to work at all. It must function without JS; only the
  enhancements (pending state, no full reload) need JS.
- Ignoring the deny/error branch. Handle `result.kind === 'deny'` / `'error'` and show
  `result.message`.

## Reference

- Actions in depth: see "Server Actions" and "Optimistic UI" in `../llms-full.txt`.
- Framework conventions: `../../AGENTS.md`.
