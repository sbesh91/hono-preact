// shims must be imported first
import "./shims/process.js";

import { hydrate } from "preact-iso";
import "preact/debug";
import { Base } from "./iso.js";

export const App = () => <Base />;

const app = document.getElementById("app") as HTMLElement;

hydrate(<App />, app);
