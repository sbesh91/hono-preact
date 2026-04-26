// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, act, cleanup, fireEvent, waitFor } from '@testing-library/preact';
import { Form } from '../form.js';
import { useAction, type ActionStub } from '../action.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Form', () => {
  it('serializes FormData to a plain object and calls mutate on submit', async () => {
    const mutate = vi.fn().mockResolvedValue(undefined);

    render(
      <Form mutate={mutate}>
        <input name="title" defaultValue="Dune" />
        <input name="year" defaultValue="2021" />
        <button type="submit">Submit</button>
      </Form>
    );

    await act(async () => {
      fireEvent.submit(screen.getByRole('button').closest('form')!);
    });

    expect(mutate).toHaveBeenCalledWith({ title: 'Dune', year: '2021' });
  });

  it('disables the fieldset when pending is true', () => {
    const mutate = vi.fn();
    render(
      <Form mutate={mutate} pending={true}>
        <input name="title" />
        <button type="submit">Submit</button>
      </Form>
    );
    const fieldset = screen.getByRole('button').closest('fieldset');
    expect(fieldset).toBeDisabled();
  });

  it('does not disable the fieldset when pending is false or absent', () => {
    const mutate = vi.fn();
    const { rerender } = render(
      <Form mutate={mutate} pending={false}>
        <input name="title" />
        <button type="submit">Submit</button>
      </Form>
    );
    expect(screen.getByRole('button').closest('fieldset')).not.toBeDisabled();

    rerender(
      <Form mutate={mutate}>
        <input name="title" />
        <button type="submit">Submit</button>
      </Form>
    );
    expect(screen.getByRole('button').closest('fieldset')).not.toBeDisabled();
  });

  it('forwards arbitrary HTML form attributes to the <form> element', () => {
    const mutate = vi.fn();
    render(
      <Form mutate={mutate} class="my-form" data-testid="theform">
        <button type="submit">Submit</button>
      </Form>
    );
    const formEl = screen.getByTestId('theform');
    expect(formEl.tagName).toBe('FORM');
    expect(formEl).toHaveClass('my-form');
  });

  it('prevents default form submission', () => {
    const mutate = vi.fn().mockResolvedValue(undefined);
    render(
      <Form mutate={mutate}>
        <button type="submit">Submit</button>
      </Form>
    );
    const formEl = screen.getByRole('button').closest('form')!;
    const submitEvent = new Event('submit', { cancelable: true, bubbles: true });
    formEl.dispatchEvent(submitEvent);
    expect(submitEvent.defaultPrevented).toBe(true);
  });

  it('forwards streaming responses through useAction.mutate', async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('chunk-1\n'));
        controller.enqueue(encoder.encode('chunk-2\n'));
        controller.close();
      },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(stream, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        })
      )
    );

    const stub: ActionStub<{ title: string }, void> = {
      __module: 'movies',
      __action: 'stream',
    };
    const onChunk = vi.fn();

    function TestForm() {
      const { mutate, pending } = useAction(stub, { onChunk });
      return (
        <Form mutate={mutate} pending={pending}>
          <input name="title" defaultValue="Dune" />
          <button type="submit">Submit</button>
        </Form>
      );
    }

    render(<TestForm />);
    await act(async () => {
      fireEvent.submit(screen.getByRole('button').closest('form')!);
    });

    await waitFor(() => expect(onChunk).toHaveBeenCalledTimes(2));
    expect(onChunk).toHaveBeenNthCalledWith(1, 'chunk-1\n');
    expect(onChunk).toHaveBeenNthCalledWith(2, 'chunk-2\n');
  });
});
