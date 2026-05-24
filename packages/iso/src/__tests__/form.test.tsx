// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/preact';
import { Form } from '../form.js';
import type { ActionStub } from '../action.js';

function makeStub(): ActionStub<{ text: string }, { id: number }, never> {
  const stub = (async () => ({ id: 1 })) as unknown as ActionStub<
    { text: string },
    { id: number },
    never
  >;
  (stub as unknown as { __module: string; __action: string; useAction: unknown }).__module =
    'pages/test.server';
  (stub as unknown as { __module: string; __action: string; useAction: unknown }).__action =
    'submit';
  return stub;
}

describe('<Form>', () => {
  it('renders no action attribute (posts to current URL)', () => {
    const { container } = render(<Form action={makeStub()} />);
    const form = container.querySelector('form')!;
    expect(form.getAttribute('action')).toBeNull();
    expect(form.getAttribute('method')?.toLowerCase()).toBe('post');
  });

  it('emits __module and __action as hidden inputs', () => {
    const { container } = render(<Form action={makeStub()} />);
    const m = container.querySelector('input[name="__module"]') as HTMLInputElement;
    const a = container.querySelector('input[name="__action"]') as HTMLInputElement;
    expect(m.value).toBe('pages/test.server');
    expect(a.value).toBe('submit');
    expect(m.type).toBe('hidden');
    expect(a.type).toBe('hidden');
  });

  it('renders enctype=multipart/form-data', () => {
    const { container } = render(<Form action={makeStub()} />);
    const form = container.querySelector('form')!;
    expect(form.getAttribute('enctype')).toBe('multipart/form-data');
  });

  it('renders the fieldset wrapper for children', () => {
    const { container } = render(
      <Form action={makeStub()}>
        <input name="text" defaultValue="hi" />
      </Form>
    );
    const fieldset = container.querySelector('fieldset.hp-form-fieldset')!;
    const input = fieldset.querySelector('input[name="text"]') as HTMLInputElement;
    expect(input.value).toBe('hi');
  });

  it('intercepts submit, calls fetch with FormData and Accept: application/json', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify({ __outcome: 'success', data: { id: 1 } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );
    const { container } = render(
      <Form action={makeStub()}>
        <input name="text" defaultValue="hi" />
        <button type="submit">go</button>
      </Form>
    );
    const form = container.querySelector('form')!;
    fireEvent.submit(form);
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0]!;
    expect((init as RequestInit).method).toBe('POST');
    expect((init as RequestInit).body).toBeInstanceOf(FormData);
    const headers = new Headers((init as RequestInit).headers);
    expect(headers.get('Accept')).toMatch(/application\/json/);
    fetchMock.mockRestore();
  });
});
