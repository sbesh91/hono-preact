import type { Context } from "hono";
import { Fragment, type FunctionComponent } from "preact";
import { Base } from "../iso.js";
import { HonoContext } from "./context.js";

export const Layout: FunctionComponent<{ context: Context }> = (props) => {
  return (
    <Fragment>
      <head>
        {import.meta.env.PROD ? (
          <link rel="stylesheet" href="/static/assets/client.css" />
        ) : (
          <link rel="stylesheet" href="/src/styles/root.css" />
        )}
      </head>
      <body class="bg-gray-300 p-2 isolate">
        <section id="app">
          <HonoContext.Provider value={props}>
            <Base />
          </HonoContext.Provider>
        </section>
        {import.meta.env.PROD ? (
          <script type="module" src="/static/client.js" />
        ) : (
          <script type="module" src="/src/client.tsx" />
        )}
      </body>
    </Fragment>
  );
};
