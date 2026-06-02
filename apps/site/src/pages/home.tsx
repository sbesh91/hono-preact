import type { FunctionComponent } from 'preact';
import { useMeta, useTitle } from 'hoofd/preact';
import { HeroShader } from '../components/HeroShader.js';

const Home: FunctionComponent = () => {
  useTitle('hono-preact');
  useMeta({
    name: 'description',
    content:
      'Hono on the edge, Preact in the browser, manifest driven routes, typed RPC, streaming everywhere.',
  });
  return (
    <div class="relative isolate overflow-hidden">
      <HeroShader />
      <main class="relative mx-auto max-w-4xl px-6 py-16 space-y-16">
        {/* Hero */}
        <section class="space-y-4 text-center">
          <span class="energy-bar w-16 mx-auto" aria-hidden="true" />
          <p class="inline-block bg-surface/70 backdrop-blur text-xs px-2 py-0.5 rounded-full border border-border">
            hono-preact v{__HONO_PREACT_VERSION__}
          </p>
          <h1 class="text-5xl font-semibold text-orangenta drop-shadow-[0_1px_3px_rgba(0,0,0,0.35)]">
            A small full-stack framework.
          </h1>
          <p class="text-lg text-muted max-w-2xl mx-auto">
            Hono on the edge, Preact in the browser, manifest driven routes,
            typed RPC, streaming everywhere.
          </p>
          <div class="flex gap-3 justify-center pt-2">
            <a
              href="/docs/quick-start"
              class="bg-accent text-accent-foreground px-4 py-2 font-medium rounded-md hover:bg-accent-hover"
            >
              Get started
            </a>
            <a
              href="/demo"
              class="border border-border text-foreground px-4 py-2 font-medium rounded-md bg-surface/80 backdrop-blur"
            >
              See the demo
            </a>
          </div>
        </section>

        {/* Code block */}
        <section class="space-y-4">
          <h2 class="text-sm uppercase tracking-wide text-muted">
            Keep it simple
          </h2>
          <div class="grid gap-3 md:grid-cols-2">
            <CodeBlock filename="vite.config.ts">
              {`import { defineApp } from 'hono-preact/vite';
export default defineApp();`}
            </CodeBlock>
            <CodeBlock filename="src/routes.ts">
              {`import { defineRoutes } from 'hono-preact';
export default defineRoutes([
  { path: '/', view: () => import('./views/home') },
]);`}
            </CodeBlock>
            <CodeBlock filename="src/views/home.tsx">
              {`export default function Home() {
  return <h1>Hello</h1>;
}`}
            </CodeBlock>
            <CodeBlock filename="src/Layout.tsx">
              {`import { ClientScript, Head } from 'hono-preact';
export default function Layout({ children }) {
  return (
    <html>
      <Head defaultTitle="hono-preact" />
      <body>
        <main id="app">{children}</main>
        <ClientScript />
      </body>
    </html>
  );
}`}
            </CodeBlock>
          </div>
        </section>

        {/* Feature cards */}
        <section class="grid gap-4 md:grid-cols-2">
          <Card title="Manifest-driven routes">
            Your routes are a data structure, not a directory tree.
          </Card>
          <Card title="Typed RPC, end to end">
            Loaders and actions are typed functions; the client gets a typed
            stub.
          </Card>
          <Card title="Streaming everywhere">
            Loaders, forms, SSE. Built on ReadableStream.
          </Card>
          <Card title="One package">
            <code>hono-preact</code>, <code>hono-preact/server</code>,{' '}
            <code>hono-preact/vite</code>. Nothing else to install.
          </Card>
        </section>

        {/* Footer */}
        <footer class="pt-8 border-t border-border text-sm text-muted flex flex-wrap gap-4 justify-between">
          <span>
            <a
              class="underline text-accent hover:text-accent-hover"
              href="https://github.com/sbesh91/hono-preact"
            >
              GitHub
            </a>{' '}
            ·{' '}
            <a
              class="underline text-accent hover:text-accent-hover"
              href="https://www.npmjs.com/package/hono-preact"
            >
              npm
            </a>
          </span>
          <span>MIT</span>
        </footer>
      </main>
    </div>
  );
};
Home.displayName = 'Home';

const CodeBlock: FunctionComponent<{
  filename: string;
  children: string;
}> = ({ filename, children }) => (
  <figure class="rounded-md border border-border bg-surface shadow-card overflow-hidden">
    <figcaption class="text-xs text-muted px-3 py-1 border-b border-border bg-surface-subtle">
      {filename}
    </figcaption>
    <pre class="text-xs p-3 overflow-x-auto">
      <code>{children}</code>
    </pre>
  </figure>
);

const Card: FunctionComponent<{ title: string; children: any }> = ({
  title,
  children,
}) => (
  <article class="rounded-md border border-border bg-surface shadow-card p-4">
    <h3 class="font-semibold mb-1">{title}</h3>
    <p class="text-sm text-muted">{children}</p>
  </article>
);

export default Home;
