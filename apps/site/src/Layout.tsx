import { ClientScript, Head, ViewTransitions } from 'hono-preact';
import root from '@/styles/root.css?url';
import type { ComponentChildren } from 'preact';

export default function Layout({ children }: { children: ComponentChildren }) {
  return (
    <html>
      <Head defaultTitle="hono-preact">
        <link rel="stylesheet" href={root} />
      </Head>
      <body class="bg-gray-300 isolate">
        <main id="app">{children}</main>
        <ClientScript />
        <ViewTransitions />
      </body>
    </html>
  );
}
