import { lazy, prerender } from "preact-iso";
import { Base } from "./iso.js";
import "./styles/root.css";

export const App = () => <Base />;

const app = document.getElementById("app") as HTMLElement;

async function start() {
  const Movies = await lazy(() => import("./pages/movies.js")).preload();
  const result = await prerender(
    <p>
      hello world
      <div>{Movies}</div>
    </p>
  );
  console.log(result);
}

start();

// hydrate(<App />, app);
