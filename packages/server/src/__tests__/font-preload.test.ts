import { describe, it, expect } from 'vitest';
import { fontMimeType, fontPreloadLinkHeader } from '../font-preload.js';

describe('fontMimeType', () => {
  it('maps known font extensions, ignoring a query string', () => {
    expect(fontMimeType('/static/x-abc.woff2')).toBe('font/woff2');
    expect(fontMimeType('/static/x.woff')).toBe('font/woff');
    expect(fontMimeType('/static/x.ttf')).toBe('font/ttf');
    expect(fontMimeType('/static/x.otf')).toBe('font/otf');
    expect(fontMimeType('/static/x.woff2?v=1')).toBe('font/woff2');
  });
  it('returns undefined for an unrecognized extension', () => {
    expect(fontMimeType('/static/x.eot')).toBeUndefined();
    expect(fontMimeType('/static/noext')).toBeUndefined();
  });
});

describe('fontPreloadLinkHeader', () => {
  it('builds an RFC 8288 preload entry per font with as=font, type, and crossorigin', () => {
    // The type value contains '/', which is not an RFC 7230 token character,
    // so it must be a quoted-string or strict Link parsers (e.g. a CDN
    // synthesizing 103 Early Hints from this header) drop the entry.
    expect(fontPreloadLinkHeader(['/static/a.woff2', '/static/b.woff2'])).toBe(
      '</static/a.woff2>; rel=preload; as=font; type="font/woff2"; crossorigin, ' +
        '</static/b.woff2>; rel=preload; as=font; type="font/woff2"; crossorigin'
    );
  });
  it('omits the type param when the extension is unrecognized', () => {
    expect(fontPreloadLinkHeader(['/static/x.eot'])).toBe(
      '</static/x.eot>; rel=preload; as=font; crossorigin'
    );
  });
  it('returns undefined for no fonts (so no empty header is set)', () => {
    expect(fontPreloadLinkHeader([])).toBeUndefined();
  });
});
