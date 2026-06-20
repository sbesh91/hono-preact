import { describe, it, expect } from 'vitest';
import {
  toFetchRequest,
  writeFetchResponse,
  type NodeRequestLike,
  type NodeResponseLike,
} from '../node-request.js';

function mockReq(opts: {
  method?: string;
  url?: string;
  headers?: Record<string, string | string[] | undefined>;
  body?: Uint8Array[];
  onBodyRead?: () => void;
}): NodeRequestLike {
  return {
    method: opts.method,
    url: opts.url,
    headers: opts.headers ?? {},
    async *[Symbol.asyncIterator]() {
      opts.onBodyRead?.();
      for (const c of opts.body ?? []) yield c;
    },
  };
}

function mockRes() {
  const res = {
    statusCode: 0,
    headers: {} as Record<string, string>,
    chunks: [] as Uint8Array[],
    ended: false,
    setHeader(k: string, v: string) {
      res.headers[k] = v;
    },
    write(c: Uint8Array) {
      res.chunks.push(c);
    },
    end() {
      res.ended = true;
    },
  };
  return res satisfies NodeResponseLike & Record<string, unknown>;
}

const enc = new TextEncoder();

describe('toFetchRequest', () => {
  it('builds the URL from host + url and the method, without reading a GET body', async () => {
    let bodyRead = false;
    const req = mockReq({
      method: 'GET',
      url: '/path?q=1',
      headers: { host: 'example.test' },
      onBodyRead: () => {
        bodyRead = true;
      },
    });
    const request = await toFetchRequest(req);
    expect(request.url).toBe('http://example.test/path?q=1');
    expect(request.method).toBe('GET');
    expect(bodyRead).toBe(false); // GET never consumes the body stream
  });

  it('buffers a POST body and exposes it on the Request', async () => {
    const req = mockReq({
      method: 'POST',
      url: '/api',
      headers: { host: 'h', 'content-type': 'text/plain' },
      body: [enc.encode('hello '), enc.encode('world')],
    });
    const request = await toFetchRequest(req);
    expect(request.method).toBe('POST');
    expect(await request.text()).toBe('hello world');
    expect(request.headers.get('content-type')).toBe('text/plain');
  });

  it('copies string headers and appends repeated (array) header values', async () => {
    const req = mockReq({
      method: 'GET',
      url: '/',
      headers: { host: 'h', 'x-single': 'one', 'x-multi': ['a', 'b'] },
    });
    const request = await toFetchRequest(req);
    expect(request.headers.get('x-single')).toBe('one');
    expect(request.headers.get('x-multi')).toBe('a, b');
  });

  it('leaves the body empty when a non-GET request sends no chunks', async () => {
    const req = mockReq({
      method: 'DELETE',
      url: '/x',
      headers: { host: 'h' },
    });
    const request = await toFetchRequest(req);
    expect(await request.text()).toBe('');
  });
});

describe('writeFetchResponse', () => {
  it('writes status, headers, and the streamed body, then ends', async () => {
    const res = mockRes();
    const response = new Response('chunk-data', {
      status: 201,
      headers: { 'x-test': 'yes' },
    });
    await writeFetchResponse(res, response);
    expect(res.statusCode).toBe(201);
    expect(res.headers['x-test']).toBe('yes');
    expect(Buffer.concat(res.chunks).toString()).toBe('chunk-data');
    expect(res.ended).toBe(true);
  });

  it('handles a bodyless response (no writes, still ends)', async () => {
    const res = mockRes();
    await writeFetchResponse(res, new Response(null, { status: 204 }));
    expect(res.statusCode).toBe(204);
    expect(res.chunks).toEqual([]);
    expect(res.ended).toBe(true);
  });

  it('flushes multiple body chunks in order (streaming)', async () => {
    const res = mockRes();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(enc.encode('a'));
        controller.enqueue(enc.encode('b'));
        controller.enqueue(enc.encode('c'));
        controller.close();
      },
    });
    await writeFetchResponse(res, new Response(stream));
    expect(res.chunks.map((c) => Buffer.from(c).toString())).toEqual([
      'a',
      'b',
      'c',
    ]);
    expect(res.ended).toBe(true);
  });
});
