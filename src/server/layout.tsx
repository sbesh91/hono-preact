import { readdirSync } from "node:fs";
import type { FunctionComponent } from "preact";
import { Base } from "../iso.js";

const getCssPaths = () => {
  return readdirSync("./src/public/")
    .filter((path) => path.endsWith(".css"))
    .map((path) => <link rel="stylesheet" href={`static/${path}`} />);
};

export const Layout: FunctionComponent = (props) => {
  return (
    <html>
      <head>{getCssPaths()}</head>
      <body class="bg-gray-300 p-2 isolate">
        <section id="app">
          <Base />
        </section>
        <script type="module" src="static/client.js"></script>
      </body>
    </html>
  );
};
