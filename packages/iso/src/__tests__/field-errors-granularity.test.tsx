// @vitest-environment happy-dom
import { describe, expect, it, afterEach } from 'vitest';
import { act, render, fireEvent, cleanup } from '@testing-library/preact';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { Form } from '../form.js';
import { FieldError, useFieldErrors } from '../use-field-errors.js';
import { defineAction } from '../action.js';
import { clearLastActionResult } from '../internal/action-result-store.js';

// Two independent required fields, so a submit produces errors on both `a`
// and `b`, and a later edit to `a` alone (client revalidation clears just
// `a`'s error) exercises a change to ONE field without touching the other.
const schema: StandardSchemaV1<unknown, { a: string; b: string }> = {
  '~standard': {
    version: 1,
    vendor: 'test',
    validate: (v) => {
      const { a, b } = v as { a?: unknown; b?: unknown };
      const issues: { message: string; path: string[] }[] = [];
      if (typeof a !== 'string' || a.length === 0)
        issues.push({ message: 'a required', path: ['a'] });
      if (typeof b !== 'string' || b.length === 0)
        issues.push({ message: 'b required', path: ['b'] });
      return issues.length > 0
        ? { issues }
        : { value: { a: a as string, b: b as string } };
    },
  },
};

const twoFieldAction = defineAction(async () => ({ ok: true }), {
  input: schema,
  __module: 'pages/test.server',
  __action: 'twoField',
});

const waitForDebounce = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 200));
  });

afterEach(() => {
  cleanup();
  clearLastActionResult('pages/test.server', 'twoField');
});

// A render-counter probe that is ITSELF the direct field-error consumer (it
// calls `useFieldErrors(name)` in its own render body), mirroring how the
// presence-granularity test counts a `Row` that itself reads `member(id)
// .value` rather than counting a wrapper around some other reader. `<FieldError
// name>` reads through the exact same `useFieldErrors(name)` channel, so this
// probe exercises the real reactive path a `<FieldError>` uses.
function FieldErrorProbe({
  name,
  counters,
}: {
  name: 'a' | 'b';
  counters: { a: number; b: number };
}) {
  counters[name]++;
  const message = useFieldErrors(name)[0];
  return message ? <span data-field-error={name}>{message}</span> : null;
}

describe('per-field <FieldError> / useFieldErrors(name) granularity', () => {
  it('a change to field a re-renders only the a consumer, not b', async () => {
    const counters = { a: 0, b: 0 };
    const { container, getByText } = render(
      <Form action={twoFieldAction} schema={schema}>
        <input name="a" />
        <FieldErrorProbe name="a" counters={counters} />
        <input name="b" />
        <FieldErrorProbe name="b" counters={counters} />
        <button type="submit">Save</button>
      </Form>
    );

    // Submit with both fields empty: both a and b get errors, so both
    // probes legitimately render at least once here.
    await act(async () => {
      fireEvent.submit(container.querySelector('form')!);
    });
    expect(getByText('a required')).toBeTruthy();
    expect(getByText('b required')).toBeTruthy();

    const aRendersAfterSubmit = counters.a;
    const bRendersAfterSubmit = counters.b;

    // Fix field a only (live revalidation, debounced). This changes ONLY
    // a's errors ([] instead of ['a required']); b's errors are untouched.
    const inputA = container.querySelector('input[name="a"]')!;
    (inputA as HTMLInputElement).value = 'hello';
    await act(async () => {
      fireEvent.input(inputA);
    });
    await waitForDebounce();

    // a's error cleared.
    expect(container.querySelector('[data-field-error="a"]')).toBeNull();
    // b's error is untouched content-wise.
    expect(getByText('b required')).toBeTruthy();

    // The headline assertion: only the `a` probe re-rendered. The `b`
    // probe's render count is unchanged because its own field-error signal
    // never changed.
    expect(counters.a).toBeGreaterThan(aRendersAfterSubmit);
    expect(counters.b).toBe(bRendersAfterSubmit);
  });

  it('the real <FieldError> component renders the same content the probe reads', async () => {
    const { container, getByText } = render(
      <Form action={twoFieldAction} schema={schema}>
        <input name="a" />
        <FieldError name="a" />
        <input name="b" />
        <FieldError name="b" />
        <button type="submit">Save</button>
      </Form>
    );
    await act(async () => {
      fireEvent.submit(container.querySelector('form')!);
    });
    expect(getByText('a required')).toBeTruthy();
    expect(getByText('b required')).toBeTruthy();
  });
});
