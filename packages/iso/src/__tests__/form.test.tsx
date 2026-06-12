// @vitest-environment happy-dom
import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup, act, waitFor } from '@testing-library/preact';
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
  (
    stub as unknown as {
      __module: string;
      __action: string;
      useAction: unknown;
    }
  ).__module = 'pages/test.server';
  (
    stub as unknown as {
      __module: string;
      __action: string;
      useAction: unknown;
    }
  ).__action = 'submit';
  return stub;
}

afterEach(() => {
  cleanup();
  clearLastActionResult('pages/test.server', 'submit');
  vi.restoreAllMocks();
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
    const m = container.querySelector(
      'input[name="__module"]'
    ) as HTMLInputElement;
    const a = container.querySelector(
      'input[name="__action"]'
    ) as HTMLInputElement;
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
    const input = fieldset.querySelector(
      'input[name="text"]'
    ) as HTMLInputElement;
    expect(input.value).toBe('hi');
  });

  it('intercepts submit, calls fetch with FormData and Accept: application/json', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
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
  });

  it('sends action identity from props even when hydrated hidden inputs are stale', async () => {
    // Repro of the hydrated-form bug: on an initial SSR page the server renders
    // __module/__action empty (server-side defineAction carries no name
    // metadata) and Preact's hydrate() does not patch existing DOM `value`s, so
    // the hidden inputs stay empty. The submit handler must source the action
    // identity from props, not from `new FormData(formEl)`, or the POST 404s
    // with "Action '' not found".
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
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
    // Simulate the stale, server-rendered empty hidden inputs hydrate() leaves
    // in place.
    const m = container.querySelector(
      'input[name="__module"]'
    ) as HTMLInputElement;
    const a = container.querySelector(
      'input[name="__action"]'
    ) as HTMLInputElement;
    m.value = '';
    a.value = '';
    fireEvent.submit(container.querySelector('form')!);
    await new Promise((r) => setTimeout(r, 0));
    const [, init] = fetchMock.mock.calls[0]!;
    const body = (init as RequestInit).body as FormData;
    expect(body.get('__module')).toBe('pages/test.server');
    expect(body.get('__action')).toBe('submit');
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
  });

  it('writes success outcome to the client store', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ __outcome: 'success', data: { id: 1 } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
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
  });

  it('writes a timeout error result instead of an unknown-outcome error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ __outcome: 'timeout', timeoutMs: 5000 }), {
        status: 504,
        headers: { 'Content-Type': 'application/json' },
      })
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
    expect(stored?.kind).toBe('error');
    if (stored?.kind === 'error') {
      expect(stored.message).toBe('Request timed out after 5000ms');
    }
  });

  it('reloads the page on a malformed (non-envelope) body', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('<!doctype html><p>not an envelope</p>', { status: 200 })
    );
    const reloadSpy = vi
      .spyOn(window.location, 'reload')
      .mockImplementation(() => {});
    const stub = makeStub();
    const { container } = render(
      <Form action={stub}>
        <button type="submit">go</button>
      </Form>
    );
    fireEvent.submit(container.querySelector('form')!);
    await new Promise((r) => setTimeout(r, 0));
    expect(reloadSpy).toHaveBeenCalledTimes(1);
    expect(
      getLastActionResult({ __module: stub.__module, __action: stub.__action })
    ).toBeNull();
  });

  it('calls onSuccess with the action data on a success outcome', async () => {
    const stub = makeStub();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ __outcome: 'success', data: { id: 7 } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )
    );
    const onSuccess = vi.fn();
    const { getByRole } = render(
      <Form action={stub} onSuccess={onSuccess}>
        <button type="submit">go</button>
      </Form>
    );
    await act(async () => {
      fireEvent.submit(getByRole('button').closest('form')!);
    });
    await waitFor(() =>
      expect(onSuccess).toHaveBeenCalledWith(
        { id: 7 },
        expect.objectContaining({ reset: expect.any(Function) })
      )
    );
  });

  it('calls onError on an error outcome and not on deny', async () => {
    const stub = makeStub();
    const onError = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ __outcome: 'error', message: 'boom' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        })
      )
    );
    const { getByRole } = render(
      <Form action={stub} onError={onError}>
        <button type="submit">go</button>
      </Form>
    );
    await act(async () => {
      fireEvent.submit(getByRole('button').closest('form')!);
    });
    await waitFor(() => expect(onError).toHaveBeenCalledOnce());
    expect(onError.mock.calls[0][0]).toBeInstanceOf(Error);
    expect((onError.mock.calls[0][0] as Error).message).toBe('boom');
  });

  it('resets the form after success when reset is set', async () => {
    const stub = makeStub();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ __outcome: 'success', data: { id: 1 } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )
    );
    const { getByRole } = render(
      <Form action={stub} reset>
        <input name="text" defaultValue="" />
        <button type="submit">go</button>
      </Form>
    );
    const input = getByRole('textbox') as HTMLInputElement;
    input.value = 'typed';
    await act(async () => {
      fireEvent.submit(getByRole('button').closest('form')!);
    });
    await waitFor(() => expect(input.value).toBe(''));
  });
});
