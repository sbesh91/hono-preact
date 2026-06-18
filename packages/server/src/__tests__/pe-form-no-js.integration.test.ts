import { describe, expect, it } from 'vitest';
import { h } from 'preact';
import { Hono } from 'hono';
import { LocationProvider } from 'preact-iso';
import { pageActionHandler, renderPage } from '../index.js';
import { makePageActionResolvers } from '../internal-runtime.js';
import { deny, useActionResult, type ServerRoute } from '@hono-preact/iso';

function Page() {
  const r = useActionResult();
  return h(
    'main',
    { 'data-test': 'page' },
    r?.kind === 'deny'
      ? h(
          'div',
          { class: 'errors' },
          h('p', null, r.message),
          h(
            'p',
            null,
            (
              (r.data as { fieldErrors?: Record<string, string[]> } | undefined)
                ?.fieldErrors?.text ?? []
            ).join(', ')
          )
        )
      : h('p', null, 'no errors')
  );
}

function Layout({ children }: { children: unknown }) {
  return h('html', null, h('body', null, children as never));
}

const submit = async () => {
  throw deny(422, 'bad', { data: { fieldErrors: { text: ['required'] } } });
};

const serverModule = {
  __moduleKey: 'pages/test.server',
  serverActions: { submit },
};

const serverThunk = async () => serverModule;

const routes: ServerRoute[] = [
  {
    path: '/test',
    server: serverThunk,
    ancestors: [],
  } as unknown as ServerRoute,
];

const multipartBody =
  '------b\r\n' +
  'Content-Disposition: form-data; name="__module"\r\n\r\n' +
  'pages/test.server\r\n' +
  '------b\r\n' +
  'Content-Disposition: form-data; name="__action"\r\n\r\n' +
  'submit\r\n' +
  '------b\r\n' +
  'Content-Disposition: form-data; name="text"\r\n\r\n' +
  '\r\n' +
  '------b--\r\n';

describe('PE form, no JS', () => {
  it('re-renders the page with deny outcome on text/html POST', async () => {
    const pageActionResolvers = makePageActionResolvers(routes, { dev: true });
    const node = h(Layout, null, h(LocationProvider, null, h(Page, null)));
    const app = new Hono()
      .post(
        '*',
        pageActionHandler({
          resolverByPath: pageActionResolvers.byPath,
          resolvePageUseByPath: async () => [], // page guards not under test here
          renderPage,
          resolvePageNode: () => node,
        })
      )
      .get('*', (c) => renderPage(c, node, {}));

    const res = await app.request('/test', {
      method: 'POST',
      headers: {
        'Content-Type': 'multipart/form-data; boundary=----b',
        Accept: 'text/html',
      },
      body: multipartBody,
    });

    expect(res.status).toBe(422);
    expect(res.headers.get('Content-Type')).toMatch(/text\/html/);
    const body = await res.text();
    expect(body).toContain('data-test="page"');
    expect(body).toContain('bad');
    expect(body).toContain('required');
  });
});
