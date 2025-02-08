import { hydrate, Route } from "preact-iso";
import "preact/debug";
import { Base } from "./iso.js";
import { Home } from "./pages/home.js";
import { Test } from "./pages/test.js";

export const App = () => (
  <Base>
    <Route path="/" component={Home} />
    <Route path="/test" component={Test} />
  </Base>
);

const app = document.getElementById("app") as HTMLElement;

hydrate(<App />, app);
