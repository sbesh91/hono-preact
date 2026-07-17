import { describe, expect, it } from 'vitest';
import { pickAccept, acceptsEventStream } from '../accept.js';

describe('pickAccept', () => {
  it('maps application/json to json', () => {
    expect(pickAccept('application/json')).toBe('json');
  });
  it('maps text/event-stream to event-stream', () => {
    expect(pickAccept('text/event-stream')).toBe('event-stream');
  });
  it('maps text/html to html', () => {
    expect(pickAccept('text/html')).toBe('html');
  });
  it('maps */* to html', () => {
    expect(pickAccept('*/*')).toBe('html');
  });
  it('defaults missing/empty Accept to html', () => {
    expect(pickAccept(undefined)).toBe('html');
    expect(pickAccept('')).toBe('html');
  });
  it('honors q-values when choosing the best candidate', () => {
    expect(pickAccept('application/json, text/event-stream;q=0.9')).toBe(
      'json'
    );
  });
  it('breaks q-value ties by Accept order', () => {
    expect(pickAccept('application/json, text/event-stream')).toBe('json');
    expect(pickAccept('text/event-stream, application/json')).toBe(
      'event-stream'
    );
  });
  it('ignores unparseable q-values (defaults q to 1.0)', () => {
    expect(pickAccept('application/json;q=invalid')).toBe('json');
  });
  it('ignores unsupported media types', () => {
    expect(pickAccept('text/plain, application/json;q=0.5')).toBe('json');
  });
  it('treats q=0 as a real (lowest) preference, not exclusion', () => {
    expect(pickAccept('application/json;q=0')).toBe('json');
  });
});

describe('acceptsEventStream', () => {
  it('rejects an absent Accept header', () => {
    expect(acceptsEventStream(undefined)).toBe(false);
  });
  it('accepts a bare text/event-stream header', () => {
    expect(acceptsEventStream('text/event-stream')).toBe(true);
  });
  it('accepts the dual header useAction sends, even though json wins pickAccept', () => {
    expect(
      acceptsEventStream('application/json, text/event-stream;q=0.9')
    ).toBe(true);
  });
  it('rejects an explicit q=0 (client cannot accept event-stream)', () => {
    expect(acceptsEventStream('text/event-stream;q=0')).toBe(false);
  });
});
