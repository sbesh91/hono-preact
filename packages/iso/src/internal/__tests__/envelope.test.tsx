// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/preact';
import { Envelope } from '../envelope.js';
import { LoaderIdContext } from '../contexts.js';

afterEach(() => {
  cleanup();
});

describe('<Envelope> data-loader serialization', () => {
  it('anchor kind="none" emits data-loader="null" regardless of value', () => {
    const { container } = render(
      <LoaderIdContext.Provider value="loader-1">
        <Envelope anchor={{ kind: 'none' }}>
          <span>child</span>
        </Envelope>
      </LoaderIdContext.Provider>
    );
    const el = container.querySelector('[data-loader]')!;
    expect(el.getAttribute('data-loader')).toBe('null');
  });

  it('anchor kind="data" with undefined value serializes as null', () => {
    const { container } = render(
      <LoaderIdContext.Provider value="loader-2">
        <Envelope anchor={{ kind: 'data', value: undefined }}>
          <span>child</span>
        </Envelope>
      </LoaderIdContext.Provider>
    );
    const el = container.querySelector('[data-loader]')!;
    expect(el.getAttribute('data-loader')).toBe('null');
  });

  it('anchor kind="data" serializes regular data as JSON', () => {
    const { container } = render(
      <LoaderIdContext.Provider value="loader-3">
        <Envelope anchor={{ kind: 'data', value: { msg: 'hi' } }}>
          <span>child</span>
        </Envelope>
      </LoaderIdContext.Provider>
    );
    const el = container.querySelector('[data-loader]')!;
    expect(el.getAttribute('data-loader')).toBe('{"msg":"hi"}');
  });
});

describe('<Envelope> hydration-orphan self-cleanup', () => {
  it('removes an orphaned duplicate node sharing its useId on mount', () => {
    const id = 'orphan-1';
    // A lazy nested-route subtree that suspends mid-hydration corrupts
    // preact-iso's sibling hydration cursor, leaving the SSR <section> for this
    // loader orphaned (a #4442-class duplicate) while the client mounts a fresh
    // node. preact-iso's Router only reclaims its own FIRST DOM node, so a
    // non-first orphan survives. Simulate that leftover SSR node here.
    const orphan = document.createElement('section');
    orphan.id = id;
    orphan.setAttribute('data-loader', 'null');
    orphan.textContent = 'ORPHAN';
    document.body.appendChild(orphan);

    render(
      <LoaderIdContext.Provider value={id}>
        <Envelope anchor={{ kind: 'none' }}>LIVE</Envelope>
      </LoaderIdContext.Provider>
    );

    const remaining = document.querySelectorAll(`[id="${id}"]`);
    expect(remaining.length).toBe(1);
    expect(remaining[0].textContent).toBe('LIVE');
  });

  it('leaves the live node untouched when there is no duplicate', () => {
    const id = 'no-orphan-1';
    const { container } = render(
      <LoaderIdContext.Provider value={id}>
        <Envelope anchor={{ kind: 'none' }}>LIVE</Envelope>
      </LoaderIdContext.Provider>
    );
    const remaining = document.querySelectorAll(`[id="${id}"]`);
    expect(remaining.length).toBe(1);
    expect(container.querySelector(`[id="${id}"]`)?.textContent).toBe('LIVE');
  });
});
