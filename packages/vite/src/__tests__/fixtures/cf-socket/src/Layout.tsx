import { ClientScript, Head } from 'hono-preact';
import type { ComponentChildren } from 'preact';

export default function Layout({ children }: { children: ComponentChildren }) {
  return (
    <html>
      <Head defaultTitle="cf-socket" />
      <body>
        <main id="app">{children}</main>
        <ClientScript />
      </body>
    </html>
  );
}
