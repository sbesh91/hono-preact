// @vitest-environment happy-dom
import { describe, expect, it, vi, afterEach } from 'vitest';
import { act, render, fireEvent, cleanup } from '@testing-library/preact';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { Form } from '../form.js';
import { FieldError } from '../use-field-errors.js';
import { defineAction } from '../action.js';

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
});
