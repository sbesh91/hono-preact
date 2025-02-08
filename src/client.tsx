import { hydrate, lazy, Route } from "preact-iso";
import "preact/debug";
import { Base } from "./iso.js";

export const Home = lazy(() => import("./pages/home.js"));
export const Test = lazy(() => import("./pages/test.js"));

export const App = () => (
  <Base>
    <Route path="/" component={Home} />
    <Route path="/test" component={Test} />
  </Base>
);

const app = document.getElementById("app") as HTMLElement;

hydrate(<App />, app);
