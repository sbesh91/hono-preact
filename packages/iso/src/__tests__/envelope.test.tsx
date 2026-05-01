// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/preact';
import { Envelope } from '../envelope.js';
import { LoaderDataContext, LoaderIdContext } from '../contexts.js';
import { env } from '../is-browser.js';

const originalEnv = env.current;
beforeEach(() => {
  env.current = 'server';
});
afterEach(() => {
  env.current = originalEnv;
  cleanup();
});

describe('<Envelope> data-loader serialization', () => {
  it('serializes undefined data as null (not the literal "undefined")', () => {
    const { container } = render(
      <LoaderIdContext.Provider value="loader-1">
        <LoaderDataContext.Provider value={{ data: undefined }}>
          <Envelope>
            <span>child</span>
          </Envelope>
        </LoaderDataContext.Provider>
      </LoaderIdContext.Provider>
    );
    const el = container.querySelector('[data-loader]')!;
    expect(el.getAttribute('data-loader')).toBe('null');
  });

  it('serializes regular data as JSON', () => {
    const { container } = render(
      <LoaderIdContext.Provider value="loader-2">
        <LoaderDataContext.Provider value={{ data: { msg: 'hi' } }}>
          <Envelope>
            <span>child</span>
          </Envelope>
        </LoaderDataContext.Provider>
      </LoaderIdContext.Provider>
    );
    const el = container.querySelector('[data-loader]')!;
    expect(el.getAttribute('data-loader')).toBe('{"msg":"hi"}');
  });
});
