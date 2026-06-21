// @vitest-environment happy-dom
import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  act,
  render,
  fireEvent,
  cleanup,
  waitFor,
} from '@testing-library/preact';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { Form } from '../form.js';
import { FieldError } from '../use-field-errors.js';
import { defineAction } from '../action.js';
import { clearLastActionResult } from '../internal/action-result-store.js';
import { VALIDATION_ISSUES_KEY } from '../internal/contract.js';

// Cross-field schema: both `password` and `confirm` are required, and they
// must match. Any pair of fields is valid iff both are non-empty AND equal.
const crossFieldSchema: StandardSchemaV1<
  unknown,
  { password: string; confirm: string }
> = {
  '~standard': {
    version: 1,
    vendor: 'test',
    validate: (v) => {
      const { password, confirm } = v as {
        password?: unknown;
        confirm?: unknown;
      };
      const issues: { message: string; path: string[] }[] = [];
      if (typeof password !== 'string' || password.length === 0)
        issues.push({ message: 'Password required', path: ['password'] });
      if (typeof confirm !== 'string' || confirm.length === 0)
        issues.push({ message: 'Confirm required', path: ['confirm'] });
      if (
        issues.length === 0 &&
        typeof password === 'string' &&
        typeof confirm === 'string' &&
        password !== confirm
      ) {
        issues.push({ message: 'Passwords must match', path: ['password'] });
        issues.push({ message: 'Passwords must match', path: ['confirm'] });
      }
      return issues.length > 0
        ? { issues }
        : {
            value: {
              password: password as string,
              confirm: confirm as string,
            },
          };
    },
  },
};

const crossFieldAction = defineAction(async () => ({ ok: true }), {
  input: crossFieldSchema,
  __module: 'pages/test.server',
  __action: 'crossField',
});

// title required; mirrors a real schema's failure on empty title.
const schema: StandardSchemaV1<unknown, { title: string }> = {
  '~standard': {
    version: 1,
    vendor: 'test',
    validate: (v) => {
      const title = (v as { title?: unknown }).title;
      return typeof title === 'string' && title.length > 0
        ? { value: { title } }
        : { issues: [{ message: 'Title is required', path: ['title'] }] };
    },
  },
};

const create = defineAction(async () => ({ id: 1 }), {
  input: schema,
  __module: 'pages/test.server',
  __action: 'create',
});

// A dedicated action for server-deny tests.
const serverDenyAction = defineAction(async () => ({ ok: true }), {
  input: schema,
  __module: 'pages/test.server',
  __action: 'serverDeny',
});

// Helper: wait for the 150ms debounce to fire.
const waitForDebounce = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 200));
  });

afterEach(() => {
  cleanup();
  clearLastActionResult('pages/test.server', 'create');
  clearLastActionResult('pages/test.server', 'crossField');
  clearLastActionResult('pages/test.server', 'serverDeny');
  vi.restoreAllMocks();
});

describe('Form client pre-validation', () => {
  it('blocks the POST and shows field errors when invalid', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch');
    const { getByText, container } = render(
      <Form action={create} schema={schema}>
        <input name="title" />
        <FieldError name="title" />
        <button type="submit">Save</button>
      </Form>
    );
    await act(async () => {
      fireEvent.submit(container.querySelector('form')!);
    });
    expect(getByText('Title is required')).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled(); // POST blocked
  });

  it('clears a field error on input once it becomes valid (after debounce)', async () => {
    const { getByText, queryByText, container } = render(
      <Form action={create} schema={schema}>
        <input name="title" />
        <FieldError name="title" />
        <button type="submit">Save</button>
      </Form>
    );
    await act(async () => {
      fireEvent.submit(container.querySelector('form')!);
    });
    expect(getByText('Title is required')).toBeTruthy();

    const input = container.querySelector('input[name="title"]')!;
    (input as HTMLInputElement).value = 'Hello';
    await act(async () => {
      fireEvent.input(input);
    });
    // Error persists until debounce fires.
    await waitForDebounce();
    expect(queryByText('Title is required')).toBeNull(); // live-cleared
  });

  it('does not trigger live revalidation before the first submit', async () => {
    // Before first submit, handleInput should stay quiet.
    const { queryByText, container } = render(
      <Form action={create} schema={schema}>
        <input name="title" />
        <FieldError name="title" />
        <button type="submit">Save</button>
      </Form>
    );
    const input = container.querySelector('input[name="title"]')!;
    (input as HTMLInputElement).value = 'Hello';
    await act(async () => {
      fireEvent.input(input);
    });
    await waitForDebounce();
    // No errors should appear before first submit attempt.
    expect(queryByText('Title is required')).toBeNull();
  });

  it('proceeds with the POST when valid', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ __outcome: 'success', data: { id: 1 } }), {
        headers: { 'Content-Type': 'application/json' },
      })
    );
    const { container } = render(
      <Form action={create} schema={schema}>
        <input name="title" value="Hello" />
        <button type="submit">Save</button>
      </Form>
    );
    await act(async () => {
      fireEvent.submit(container.querySelector('form')!);
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('fires the consumer onInput handler alongside the framework handler', async () => {
    const spy = vi.fn();
    const { container } = render(
      <Form action={create} schema={schema} onInput={spy}>
        <input name="title" />
        <FieldError name="title" />
        <button type="submit">Save</button>
      </Form>
    );
    // Trigger an error first so we are in validating mode.
    await act(async () => {
      fireEvent.submit(container.querySelector('form')!);
    });
    const input = container.querySelector('input[name="title"]')!;
    await act(async () => {
      fireEvent.input(input);
    });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  // Cross-field both directions: a schema where field B depends on A.
  // After submit shows both errors; fixing A so B becomes valid clears B;
  // editing A so B becomes newly-invalid surfaces B's error live.
  it('clears cross-field stale errors on all errored fields when one field becomes valid', async () => {
    const { getByText, queryByText, container } = render(
      <Form action={crossFieldAction} schema={crossFieldSchema}>
        <input name="password" />
        <FieldError name="password" />
        <input name="confirm" />
        <FieldError name="confirm" />
        <button type="submit">Save</button>
      </Form>
    );
    // Submit with both fields empty -> both error.
    await act(async () => {
      fireEvent.submit(container.querySelector('form')!);
    });
    expect(getByText('Password required')).toBeTruthy();
    expect(getByText('Confirm required')).toBeTruthy();

    const passwordInput = container.querySelector('input[name="password"]')!;
    const confirmInput = container.querySelector('input[name="confirm"]')!;

    // Set password to 'hello'; confirm is still empty -> password clears,
    // confirm still errors (full-form revalidation shows all current errors).
    (passwordInput as HTMLInputElement).value = 'hello';
    await act(async () => {
      fireEvent.input(passwordInput);
    });
    await waitForDebounce();
    expect(queryByText('Password required')).toBeNull();
    expect(getByText('Confirm required')).toBeTruthy();

    // Set confirm to 'hello' (matches); now both fields should be clear.
    (confirmInput as HTMLInputElement).value = 'hello';
    await act(async () => {
      fireEvent.input(confirmInput);
    });
    await waitForDebounce();
    expect(queryByText('Password required')).toBeNull();
    expect(queryByText('Confirm required')).toBeNull();
  });

  // Cross-field in the other direction: start both valid and matching, then
  // break matching by editing one field so the BOTH fields show an error live.
  it('surfaces a newly-invalid cross-field error on full revalidation', async () => {
    const { queryAllByText, queryByText, container } = render(
      <Form action={crossFieldAction} schema={crossFieldSchema}>
        <input name="password" />
        <FieldError name="password" />
        <input name="confirm" />
        <FieldError name="confirm" />
        <button type="submit">Save</button>
      </Form>
    );
    const passwordInput = container.querySelector(
      'input[name="password"]'
    )! as HTMLInputElement;
    const confirmInput = container.querySelector(
      'input[name="confirm"]'
    )! as HTMLInputElement;

    // Fill both with the same value and submit (valid).
    passwordInput.value = 'hello';
    confirmInput.value = 'hello';
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ __outcome: 'success', data: { ok: true } }),
        {
          headers: { 'Content-Type': 'application/json' },
        }
      )
    );
    await act(async () => {
      fireEvent.submit(container.querySelector('form')!);
    });
    // Wait for submit to complete (async fetch chain).
    await waitFor(() =>
      expect(
        container.querySelector('fieldset')!.hasAttribute('disabled')
      ).toBe(false)
    );
    // No client errors on valid submit.
    expect(queryByText('Passwords must match')).toBeNull();

    // Now break the match by changing password to something different.
    // confirm stays 'hello', password is now 'changed' -> mismatch.
    passwordInput.value = 'changed';
    await act(async () => {
      fireEvent.input(passwordInput);
    });
    await waitForDebounce();
    // Full revalidation surfaces the mismatch error on BOTH fields (same message text).
    expect(queryAllByText('Passwords must match').length).toBe(2);
  });

  // [Fix 0] Server-scoping: a plain-form server deny(422) shows its field errors.
  // (Optimistic path is exercised by the same useActionResult code path since
  // [Fix 0] passes the action stub directly in both cases.)
  it('shows server deny(422) field errors scoped to this form', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          __outcome: 'deny',
          status: 422,
          message: 'Validation failed',
          // Server uses VALIDATION_ISSUES_KEY with ValidationIssue[] format.
          data: {
            [VALIDATION_ISSUES_KEY]: [
              { message: 'Title too long', path: ['title'] },
            ],
          },
        }),
        { status: 422, headers: { 'Content-Type': 'application/json' } }
      )
    );
    const { getByText, container } = render(
      <Form action={serverDenyAction} schema={schema}>
        <input name="title" defaultValue="Valid title" />
        <FieldError name="title" />
        <button type="submit">Save</button>
      </Form>
    );
    // Submit valid client payload; server returns 422.
    await act(async () => {
      fireEvent.submit(container.querySelector('form')!);
    });
    // Wait for the async fetch chain to complete (deny result stored -> re-render).
    await waitFor(() => expect(getByText('Title too long')).toBeTruthy());
  });

  // [Fix 1] Server-error clear: typing into a field with a server error adds
  // it to clearedServerFields (suppressing the server error), then after the
  // debounce revalidation passes, the field stays clear. Un-edited fields' server
  // errors persist.
  it('clears a server error for an edited field after debounce revalidation', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          __outcome: 'deny',
          status: 422,
          message: 'Validation failed',
          // Server uses VALIDATION_ISSUES_KEY with ValidationIssue[] format.
          data: {
            [VALIDATION_ISSUES_KEY]: [
              { message: 'Title too long', path: ['title'] },
              { message: 'Other error', path: ['other'] },
            ],
          },
        }),
        { status: 422, headers: { 'Content-Type': 'application/json' } }
      )
    );
    const { getByText, queryByText, container } = render(
      <Form action={serverDenyAction} schema={schema}>
        <input name="title" defaultValue="Valid title" />
        <FieldError name="title" />
        <input name="other" />
        <FieldError name="other" />
        <button type="submit">Save</button>
      </Form>
    );
    // Submit; server returns deny with two field errors.
    await act(async () => {
      fireEvent.submit(container.querySelector('form')!);
    });
    // Wait for the full async fetch + deny result to render.
    await waitFor(() => expect(getByText('Title too long')).toBeTruthy());
    expect(getByText('Other error')).toBeTruthy();

    // Edit the 'title' field. The input event synchronously adds 'title' to
    // clearedServerFields. The debounce fires after 150ms and revalidates the
    // whole form; since 'Short' is valid, clientErrors becomes {}. Combined,
    // fieldErrors = serverErrors filtered (removes 'title') + {} = {other: [...]}.
    const titleInput = container.querySelector('input[name="title"]')!;
    (titleInput as HTMLInputElement).value = 'Short';
    await act(async () => {
      fireEvent.input(titleInput);
    });
    // After debounce completes: title error is gone, 'other' persists.
    await waitForDebounce();
    expect(queryByText('Title too long')).toBeNull();
    // 'other' field was not edited; not in clearedServerFields; server error stays.
    expect(getByText('Other error')).toBeTruthy();
  });

  // Fix [7]: the async sequence guard. We verify it does not apply a stale
  // result by resolving two validations out of order.
  it('ignores a stale async validation result superseded by a newer keystroke', async () => {
    // A schema whose validate function we can control.
    const controlledSchema: StandardSchemaV1<unknown, { title: string }> = {
      '~standard': {
        version: 1,
        vendor: 'test',
        // Always fail so submit primes clientErrors.
        validate: () => ({
          issues: [{ message: 'Title is required', path: ['title'] }],
        }),
      },
    };

    const { getByText, queryByText, container } = render(
      <Form action={create} schema={controlledSchema}>
        <input name="title" />
        <FieldError name="title" />
        <button type="submit">Save</button>
      </Form>
    );

    // Submit with always-failing schema to enter validating mode + prime error.
    await act(async () => {
      fireEvent.submit(container.querySelector('form')!);
    });
    expect(getByText('Title is required')).toBeTruthy();

    // Now swap validate to an async version we control. We use two manually
    // resolved promises to simulate out-of-order async resolutions. The
    // debounce collapses rapid keystrokes to one call, so we force two
    // separate debounce windows by waiting between keystrokes.
    let resolveFirst!: (r: { value: { title: string } }) => void;
    let resolveSecond!: (r: {
      issues: { message: string; path: string[] }[];
    }) => void;
    const firstPromise = new Promise<{ value: { title: string } }>((res) => {
      resolveFirst = res;
    });
    const secondPromise = new Promise<{
      issues: { message: string; path: string[] }[];
    }>((res) => {
      resolveSecond = res;
    });
    let callCount = 0;
    (
      controlledSchema['~standard'] as { validate: (v: unknown) => unknown }
    ).validate = () => {
      callCount++;
      if (callCount === 1) return firstPromise as never;
      return secondPromise as never;
    };

    const titleInput = container.querySelector('input[name="title"]')!;
    // First keystroke; wait for debounce to fire the first validate call.
    (titleInput as HTMLInputElement).value = 'A';
    await act(async () => {
      fireEvent.input(titleInput);
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 200));
    });
    expect(callCount).toBe(1); // first call in flight

    // Second keystroke after the first debounce has fired; starts a new one.
    (titleInput as HTMLInputElement).value = 'B';
    await act(async () => {
      fireEvent.input(titleInput);
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 200));
    });
    expect(callCount).toBe(2); // second call in flight

    // Resolve the SECOND (newer) call first with an error result.
    await act(async () => {
      resolveSecond({
        issues: [{ message: 'Title is required', path: ['title'] }],
      });
      await new Promise((r) => setTimeout(r, 0));
    });
    // Second result won: error shows.
    expect(getByText('Title is required')).toBeTruthy();

    // Resolve the FIRST (stale) call with a valid result; must NOT clear the error.
    await act(async () => {
      resolveFirst({ value: { title: 'A' } });
      await new Promise((r) => setTimeout(r, 0));
    });
    // Stale valid result must NOT clear the error surfaced by the second call.
    expect(getByText('Title is required')).toBeTruthy();
  });
});
