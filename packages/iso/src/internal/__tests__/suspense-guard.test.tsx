// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { render, waitFor } from '@testing-library/preact';
import { options } from 'preact';
import type { ComponentChildren } from 'preact';
import { Suspense } from '../suspense.js';

/** A child that throws a promise until it is resolved, then renders text. */
function makeSuspender(text: string) {
  let resolveFn!: () => void;
  let done = false;
  const promise = new Promise<void>((r) => {
    resolveFn = () => {
      done = true;
      r();
    };
  });
  const Child = () => {
    if (!done) throw promise;
    return <div>{text}</div>;
  };
  return { Child, resolve: resolveFn, promise };
}

describe('compat-free Suspense (mangle-map guard)', () => {
  it('catches a thrown promise, shows fallback, then resolves to content', async () => {
    const { Child, resolve, promise } = makeSuspender('loaded');
    const { getByText, queryByText } = render(
      <Suspense fallback={<span>loading</span>}>
        <Child />
      </Suspense>
    );
    // Fallback is shown while suspended: proves __e walked to _childDidSuspend.
    expect(getByText('loading')).toBeTruthy();
    expect(queryByText('loaded')).toBeNull();
    resolve();
    await promise;
    await waitFor(() => expect(getByText('loaded')).toBeTruthy());
  });

  it('resolves two sibling suspenders under one boundary out of order', async () => {
    const a = makeSuspender('A');
    const b = makeSuspender('B');
    const { getByText, queryByText } = render(
      <Suspense fallback={<span>loading</span>}>
        <a.Child />
        <b.Child />
      </Suspense>
    );
    expect(getByText('loading')).toBeTruthy();
    // Resolve B first, then A: the boundary must wait for BOTH.
    b.resolve();
    await b.promise;
    expect(queryByText('A')).toBeNull();
    a.resolve();
    await a.promise;
    await waitFor(() => {
      expect(getByText('A')).toBeTruthy();
      expect(getByText('B')).toBeTruthy();
    });
  });

  it('preact still exposes the _catchError hook this module patches (canary)', () => {
    // If a preact bump renames the mangled __e key, suspension silently breaks
    // upstream; this assertion fails first and names the cause.
    expect('__e' in options).toBe(true);
    expect(typeof (options as Record<string, unknown>).__e).toBe('function');
  });
});
