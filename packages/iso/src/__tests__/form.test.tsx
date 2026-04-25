// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, act, cleanup, fireEvent } from '@testing-library/preact';
import { Form } from '../form.js';
import type { ActionStub } from '../action.js';
import { cacheRegistry } from '../cache-registry.js';

const stub: ActionStub<{ title: string }, { ok: boolean }> = {
  __module: 'movies',
  __action: 'create',
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  cacheRegistry.clear();
});

describe('Form', () => {
  it('serializes FormData to object and posts to /__actions on submit', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 })
    );
    vi.stubGlobal('fetch', fetchMock);

    render(
      <Form action={stub}>
        <input name="title" defaultValue="Dune" />
        <button type="submit">Submit</button>
      </Form>
    );

    await act(async () => {
      fireEvent.submit(screen.getByRole('button').closest('form')!);
    });

    expect(fetchMock).toHaveBeenCalledWith('/__actions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ module: 'movies', action: 'create', payload: { title: 'Dune' } }),
    });
  });

  it('disables submit button while pending', async () => {
    let resolveFetch!: (v: Response) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((r) => {
            resolveFetch = r;
          })
      )
    );

    render(
      <Form action={stub}>
        <input name="title" defaultValue="Dune" />
        <button type="submit">Submit</button>
      </Form>
    );

    await act(async () => {
      fireEvent.submit(screen.getByRole('button').closest('form')!);
    });

    expect(screen.getByRole('button')).toBeDisabled();

    await act(async () => {
      resolveFetch(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    });

    expect(screen.getByRole('button')).not.toBeDisabled();
  });

  it('calls onSuccess after successful submission', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), { status: 200 })
      )
    );
    const onSuccess = vi.fn();

    render(
      <Form action={stub} onSuccess={onSuccess}>
        <input name="title" defaultValue="Dune" />
        <button type="submit">Submit</button>
      </Form>
    );

    await act(async () => {
      fireEvent.submit(screen.getByRole('button').closest('form')!);
    });

    expect(onSuccess).toHaveBeenCalledWith({ ok: true });
  });

  it('calls cacheRegistry.invalidate for each name in invalidate: string[]', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), { status: 200 })
      )
    );

    const mockInvalidateMovies = vi.fn();
    const mockInvalidateActors = vi.fn();
    cacheRegistry.register('movies', mockInvalidateMovies);
    cacheRegistry.register('actors', mockInvalidateActors);

    render(
      <Form action={stub} invalidate={['movies', 'actors']}>
        <input name="title" defaultValue="Dune" />
        <button type="submit">Submit</button>
      </Form>
    );

    await act(async () => {
      fireEvent.submit(screen.getByRole('button').closest('form')!);
    });

    expect(mockInvalidateMovies).toHaveBeenCalled();
    expect(mockInvalidateActors).toHaveBeenCalled();
  });
});
