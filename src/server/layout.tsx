import type { Context } from "hono";
import { Fragment, type FunctionComponent } from "preact";
import { Base } from "../iso.js";
import root from "../styles/root.css?url";
import { HonoContext } from "./context.js";

export const Layout: FunctionComponent<{ context: Context }> = (props) => {
  return (
    <Fragment>
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <link rel="stylesheet" href={root} />
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
