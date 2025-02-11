import { hydrate } from "preact-iso";
import { Base } from "./iso.js";
import "./shims/process.js";
import "./styles/root.css";

export const App = () => <Base />;

const app = document.getElementById("app") as HTMLElement;

hydrate(<App />, app);
