import { ClientScript, Head } from 'hono-preact';
import type { ComponentChildren } from 'preact';

export default function Layout({ children }: { children: ComponentChildren }) {
  return (
    <html>
      <Head defaultTitle="{{name}}" />
      <body>
        <main id="app">{children}</main>
        <ClientScript />
      </body>
    </html>
  );
}
