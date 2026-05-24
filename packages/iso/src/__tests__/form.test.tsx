// @vitest-environment happy-dom
import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/preact';
import { Form } from '../form.js';
import type { ActionStub } from '../action.js';
import {
  clearLastActionResult,
  getLastActionResult,
} from '../internal/action-result-store.js';

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

afterEach(() => {
  cleanup();
  clearLastActionResult('pages/test.server', 'submit');
});

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

  it('writes deny outcome to the client store on JS-on path', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          __outcome: 'deny',
          status: 422,
          message: 'bad',
          data: { fieldErrors: { text: ['nope'] } },
        }),
        { status: 422, headers: { 'Content-Type': 'application/json' } }
      )
    );
    const stub = makeStub();
    const { container } = render(
      <Form action={stub}>
        <input name="text" defaultValue="hi" />
        <button type="submit">go</button>
      </Form>
    );
    fireEvent.submit(container.querySelector('form')!);
    await new Promise((r) => setTimeout(r, 0));
    const stored = getLastActionResult({
      __module: stub.__module,
      __action: stub.__action,
    });
    expect(stored?.kind).toBe('deny');
    if (stored?.kind === 'deny') {
      expect(stored.status).toBe(422);
      expect(stored.message).toBe('bad');
    }
    vi.restoreAllMocks();
  });

  it('writes success outcome to the client store', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ __outcome: 'success', data: { id: 1 } }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    );
    const stub = makeStub();
    const { container } = render(
      <Form action={stub}>
        <button type="submit">go</button>
      </Form>
    );
    fireEvent.submit(container.querySelector('form')!);
    await new Promise((r) => setTimeout(r, 0));
    const stored = getLastActionResult({
      __module: stub.__module,
      __action: stub.__action,
    });
    expect(stored?.kind).toBe('success');
    vi.restoreAllMocks();
  });
});
