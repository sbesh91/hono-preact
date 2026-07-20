import { describe, it, expect } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import { LoaderIdContext } from '../contexts.js';
import { Envelope } from '../envelope.js';

describe('Envelope deny anchor', () => {
  it('emits data-loader-deny and no data-loader for a deny anchor', () => {
    const html = renderToString(
      <LoaderIdContext.Provider value="L1">
        <Envelope anchor={{ kind: 'deny', message: 'No project named nope.' }}>
          <p>denied</p>
        </Envelope>
      </LoaderIdContext.Provider>
    );
    expect(html).toContain('data-loader-deny="');
    expect(html).toContain('No project named nope.');
    expect(html).not.toContain('data-loader="');
  });

  it('still emits data-loader for a data anchor', () => {
    const html = renderToString(
      <LoaderIdContext.Provider value="L2">
        <Envelope anchor={{ kind: 'data', value: { a: 1 } }}>
          <p>ok</p>
        </Envelope>
      </LoaderIdContext.Provider>
    );
    expect(html).toContain('data-loader="');
    expect(html).not.toContain('data-loader-deny');
  });
});
