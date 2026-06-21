// @vitest-environment happy-dom
import { describe, expect, it, vi, afterEach } from 'vitest';
import { act, render, fireEvent, cleanup } from '@testing-library/preact';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { Form } from '../form.js';
import { FieldError } from '../use-field-errors.js';
import { defineAction } from '../action.js';

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

afterEach(() => {
  cleanup();
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

  it('clears a field error on input once it becomes valid', async () => {
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
    await act(async () => {
      fireEvent.input(input, { target: { value: 'Hello' } });
    });
    expect(queryByText('Title is required')).toBeNull(); // live-cleared
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

  // Fix [1]: consumer onInput must not be silently dropped.
  it('fires the consumer onInput handler alongside the framework handler', async () => {
    const spy = vi.fn();
    const { container } = render(
      <Form action={create} schema={schema} onInput={spy}>
        <input name="title" />
        <FieldError name="title" />
        <button type="submit">Save</button>
      </Form>
    );
    // Trigger an error first so handleInput has something to react to.
    await act(async () => {
      fireEvent.submit(container.querySelector('form')!);
    });
    const input = container.querySelector('input[name="title"]')!;
    await act(async () => {
      fireEvent.input(input);
    });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  // Fix [2]: cross-field schema must clear stale errors on ALL errored fields
  // when the user fixes one field (not just the field being typed into).
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

    // Type a valid value into `password`. The schema now also validates `confirm`
    // (still empty), so `confirm` error should persist, but the password error
    // clears. Then fill `confirm` to match so both clear.
    const passwordInput = container.querySelector('input[name="password"]')!;
    const confirmInput = container.querySelector('input[name="confirm"]')!;

    // Set password to 'hello'; confirm is still empty -> password clears,
    // confirm still errors.
    (passwordInput as HTMLInputElement).value = 'hello';
    await act(async () => {
      fireEvent.input(passwordInput);
    });
    expect(queryByText('Password required')).toBeNull();
    expect(getByText('Confirm required')).toBeTruthy();

    // Set confirm to 'hello' (matches); now both fields should be clear.
    (confirmInput as HTMLInputElement).value = 'hello';
    await act(async () => {
      fireEvent.input(confirmInput);
    });
    expect(queryByText('Password required')).toBeNull();
    expect(queryByText('Confirm required')).toBeNull();
  });

  // Fix [7]: the async sequence guard. We verify it does not apply a stale
  // result by resolving two validations out of order.
  it('ignores a stale async validation result superseded by a newer keystroke', async () => {
    // Use a synchronous schema for the initial submit to prime clientErrors,
    // then swap to a controlled async validate for the two overlapping input events.
    const syncSchema: StandardSchemaV1<unknown, { title: string }> = {
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
      <Form action={create} schema={syncSchema}>
        <input name="title" />
        <FieldError name="title" />
        <button type="submit">Save</button>
      </Form>
    );

    // Submit with always-failing schema to prime the 'title' error.
    await act(async () => {
      fireEvent.submit(container.querySelector('form')!);
    });
    expect(getByText('Title is required')).toBeTruthy();

    // Now swap validate to an async version we control.
    let resolveInput1!: (r: {
      issues: { message: string; path: string[] }[];
    }) => void;
    let resolveInput2!: (r: { value: { title: string } }) => void;
    const input1Promise = new Promise<{
      issues: { message: string; path: string[] }[];
    }>((res) => {
      resolveInput1 = res;
    });
    const input2Promise = new Promise<{ value: { title: string } }>((res) => {
      resolveInput2 = res;
    });
    let inputCallCount = 0;
    (
      syncSchema['~standard'] as { validate: (v: unknown) => unknown }
    ).validate = () => {
      inputCallCount++;
      if (inputCallCount === 1) return input1Promise as never;
      return input2Promise as never;
    };

    const titleInput = container.querySelector('input[name="title"]')!;
    // First keystroke (stale): fires, awaits input1Promise.
    fireEvent.input(titleInput);
    // Second keystroke (newer): fires, awaits input2Promise.
    fireEvent.input(titleInput);

    // Resolve the SECOND (newer) call first with a valid result.
    await act(async () => {
      resolveInput2({ value: { title: 'Hello' } });
      // Flush all pending microtasks so the async handler runs to completion.
      await new Promise((r) => setTimeout(r, 0));
    });
    // Error should be gone (second call won).
    expect(queryByText('Title is required')).toBeNull();

    // Now resolve the FIRST (stale) call with an error result.
    await act(async () => {
      resolveInput1({
        issues: [{ message: 'Title is required', path: ['title'] }],
      });
      await new Promise((r) => setTimeout(r, 0));
    });
    // Stale result must NOT revive the error.
    expect(queryByText('Title is required')).toBeNull();
  });
});
