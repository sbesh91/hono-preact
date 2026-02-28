import { Base } from '@/iso.js';
import { Head, HeadContextProvider } from '@/iso/head.js';
import root from '@/styles/root.css?url';
import type { Context } from 'hono';
import { LazyMotion } from 'motion/react';
import { type FunctionComponent } from 'preact';
import { LocationProvider } from 'preact-iso';
import { HonoContext } from './context.js';

const loadFeatures = () => import('motion/react').then((m) => m.domAnimation);

export const Layout: FunctionComponent<{ context: Context }> = (props) => {
  return (
    <LocationProvider>
      <HeadContextProvider>
        <head>
          <meta charset="UTF-8" />
          <meta
            name="viewport"
            content="width=device-width, initial-scale=1.0"
          />
          <title>hono-preact</title>
          <link rel="stylesheet" href={root} />
          <Head />
          <template id="head"></template>
        </head>
        <body class="bg-gray-300 p-2 isolate">
          <section id="app">
            <LazyMotion features={loadFeatures} strict>
              <HonoContext.Provider value={props}>
                <Base />
              </HonoContext.Provider>
            </LazyMotion>
          </section>
          {import.meta.env.PROD ? (
            <script type="module" src="/static/client.js" />
          ) : (
            <script type="module" src="/src/client.tsx" />
          )}
        </body>
      </HeadContextProvider>
    </LocationProvider>
  );
};
