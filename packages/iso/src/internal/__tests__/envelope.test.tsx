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
