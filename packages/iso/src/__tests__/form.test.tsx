// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, act, cleanup, fireEvent } from '@testing-library/preact';
import { Form } from '../form.js';

afterEach(() => {
  cleanup();
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
});
