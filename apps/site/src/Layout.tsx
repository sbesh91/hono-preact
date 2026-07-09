import { ClientScript, Head } from 'hono-preact';
import root from '@/styles/root.css?url';
import type { ComponentChildren } from 'preact';

// Runs synchronously before first paint so a stored Light/Dark choice applies
// without a flash. No stored choice leaves data-theme unset, so the
// prefers-color-scheme default governs. Lives in <head>, outside #app, so it
// does not participate in hydration.
const THEME_INIT = `(function(){try{var t=localStorage.getItem('theme');if(t==='light'||t==='dark'){document.documentElement.setAttribute('data-theme',t);}}catch(e){}})();`;

export default function Layout({ children }: { children: ComponentChildren }) {
  return (
    <html lang="en">
      <Head defaultTitle="hono-preact">
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
        <link rel="stylesheet" href={root} />
        <link
          rel="alternate"
          type="text/plain"
          href="/llms.txt"
          title="llms.txt"
        />
      </Head>
      <body class="bg-background text-foreground font-sans antialiased isolate">
        <main id="app">{children}</main>
        <ClientScript />
      </body>
    </html>
  );
}
