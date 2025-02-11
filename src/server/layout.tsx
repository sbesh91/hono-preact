import type { Context } from "hono";
import { readdirSync } from "node:fs";
import type { FunctionComponent } from "preact";
import { Base } from "../iso.js";
import { HonoContext } from "./context.js";

const getCssPaths = () => {
  return readdirSync("./src/public/")
    .filter((path) => path.endsWith(".css"))
    .map((path) => <link rel="stylesheet" href={`/static/${path}`} />);
};

export const Layout: FunctionComponent<{ context: Context }> = (props) => {
  return (
    <html>
      <head>{getCssPaths()}</head>
      <body class="bg-gray-300 p-2 isolate">
        <section id="app">
          <HonoContext.Provider value={props}>
            <Base />
          </HonoContext.Provider>
        </section>
        <script type="module" src="/static/client.js"></script>
      </body>
    </html>
  );
};
