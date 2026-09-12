import { describe, it, expect, afterEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import {
  walkBootGraph,
  moduleScripts,
  staticImports,
  resolveModuleUrl,
  formatGraphFailures,
} from '../module-graph.js';

/**
 * The checker's own tests.
 *
 * `walkBootGraph` is the smoke suite's only assertion that the client a page
 * ships can load, and a check that cannot fail proves nothing. These boot a
 * tiny server that reproduces the #392 shape exactly -- a module request
 * answered with the SSR document, `200 text/html` -- and confirm the walk
 * reports it.
 */

type Routes = Record<string, { type: string; body: string }>;

let server: Server | undefined;

/** Serve a fixed route table; anything unlisted answers like an SSR catch-all. */
async function serveFixture(routes: Routes): Promise<string> {
  server = createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0]!;
    const hit = routes[path];
    if (hit) {
      res.writeHead(200, { 'content-type': hit.type });
      res.end(hit.body);
      return;
    }
    // The failure mode under test: the page handler answers a module request.
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<!DOCTYPE html><html><body>SSR not found</body></html>');
  });
  await new Promise<void>((r) => server!.listen(0, r));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return `http://localhost:${port}`;
}

afterEach(async () => {
  if (server) await new Promise((r) => server!.close(r));
  server = undefined;
});

const page = (scripts: string) =>
  `<!DOCTYPE html><html><head>${scripts}</head><body><div id="app">ssr</div></body></html>`;

describe('moduleScripts', () => {
  it('collects module srcs and inline module bodies, ignoring classic scripts', () => {
    const html = page(
      `<script src="/classic.js"></script>` +
        `<script type="module" src="/entry.js"></script>` +
        `<script type="module">import '/inline-dep.js';</script>`
    );
    expect(moduleScripts(html)).toEqual({
      srcs: ['/entry.js'],
      inline: [`import '/inline-dep.js';`],
    });
  });
});

describe('staticImports', () => {
  it('finds from-clause, side-effect, and re-export specifiers', () => {
    expect(
      staticImports(
        `import a from './a.js';\nimport './b.js';\nexport * from '/c.js';\n`
      )
    ).toEqual(expect.arrayContaining(['./a.js', './b.js', '/c.js']));
  });

  it('ignores dynamic imports, comments, and lookalike strings', () => {
    const src = [
      `// import './commented.js';`,
      `/* import './blocked.js'; */`,
      `const p = import('./dynamic.js');`,
      `const s = './plain-string.js';`,
    ].join('\n');
    expect(staticImports(src)).toEqual([]);
  });
});

describe('resolveModuleUrl', () => {
  const origin = 'http://localhost:1234';
  const from = `${origin}/src/entry.js`;

  it('resolves relative and absolute specifiers against the importer', () => {
    expect(resolveModuleUrl('./dep.js', from, origin)).toBe(
      `${origin}/src/dep.js`
    );
    expect(resolveModuleUrl('/src/routes.ts', from, origin)).toBe(
      `${origin}/src/routes.ts`
    );
  });

  it('skips bare specifiers and other origins', () => {
    expect(resolveModuleUrl('preact', from, origin)).toBeNull();
    expect(
      resolveModuleUrl('https://cdn.example.com/x.js', from, origin)
    ).toBeNull();
  });
});

describe('walkBootGraph', () => {
  it('passes when every module in the graph is served as JavaScript', async () => {
    const base = await serveFixture({
      '/entry.js': {
        type: 'text/javascript',
        body: `import '/src/routes.js';`,
      },
      '/src/routes.js': {
        type: 'text/javascript',
        body: `export const r = 1;`,
      },
    });
    const result = await walkBootGraph(
      `${base}/`,
      page('<script type="module" src="/entry.js"></script>')
    );
    expect(result.failures).toEqual([]);
    expect(result.checked).toEqual([
      `${base}/entry.js`,
      `${base}/src/routes.js`,
    ]);
  });

  it('fails a transitively imported module answered with the SSR document (#392)', async () => {
    // /src/routes.ts is unlisted, so the fixture answers it the way the Node
    // adapter did: 200 text/html, the SSR page.
    const base = await serveFixture({
      '/entry.js': {
        type: 'text/javascript',
        body: `import '/src/routes.ts';`,
      },
    });
    const result = await walkBootGraph(
      `${base}/`,
      page('<script type="module" src="/entry.js"></script>')
    );
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toMatchObject({
      url: `${base}/src/routes.ts`,
      status: 200,
      contentType: 'text/html',
      via: `${base}/entry.js`,
    });
    expect(formatGraphFailures(result)).toContain('SSR not found');
  });

  it('fails the document script itself when it is not served as a module', async () => {
    const base = await serveFixture({});
    const result = await walkBootGraph(
      `${base}/`,
      page('<script type="module" src="/entry.js"></script>')
    );
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.via).toBe('<document>');
  });

  it('follows imports of an inline module block', async () => {
    const base = await serveFixture({});
    const result = await walkBootGraph(
      `${base}/`,
      page(`<script type="module">import '/src/entry-client.tsx';</script>`)
    );
    expect(result.checked).toEqual([`${base}/src/entry-client.tsx`]);
    expect(result.failures).toHaveLength(1);
  });

  it('stops at maxDepth and never exceeds maxModules', async () => {
    const base = await serveFixture({
      '/a.js': { type: 'text/javascript', body: `import '/b.js';` },
      '/b.js': { type: 'text/javascript', body: `import '/c.js';` },
      '/c.js': { type: 'text/javascript', body: `export const c = 1;` },
    });
    const shallow = await walkBootGraph(
      `${base}/`,
      page('<script type="module" src="/a.js"></script>'),
      { maxDepth: 1 }
    );
    expect(shallow.checked).toEqual([`${base}/a.js`, `${base}/b.js`]);

    const capped = await walkBootGraph(
      `${base}/`,
      page('<script type="module" src="/a.js"></script>'),
      { maxModules: 2 }
    );
    expect(capped.checked).toHaveLength(2);
  });

  it('does not walk the imports of a module that came back as HTML', async () => {
    // The HTML error page mentions a path that looks like an import; walking it
    // would chase the error page's own content instead of the real graph.
    const base = await serveFixture({
      '/entry.js': {
        type: 'text/html',
        body: `<html>import '/should-not-be-fetched.js';</html>`,
      },
    });
    const result = await walkBootGraph(
      `${base}/`,
      page('<script type="module" src="/entry.js"></script>')
    );
    expect(result.checked).toEqual([`${base}/entry.js`]);
  });

  it('records a refused connection as a failure rather than throwing', async () => {
    // A closed port: the fetch rejects. The walk must still name the module and
    // its importer instead of aborting with a bare network error.
    const base = await serveFixture({});
    const port = Number(new URL(base).port);
    await new Promise((r) => server!.close(r));
    server = undefined;

    const result = await walkBootGraph(
      `http://localhost:${port}/`,
      page(`<script type="module" src="/entry.js"></script>`)
    );
    expect(result.checked).toEqual([`http://localhost:${port}/entry.js`]);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toMatchObject({ status: 0, via: '<document>' });
  });
});
