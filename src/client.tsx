import { lazy, prerender } from "preact-iso";
import { Suspense } from "preact/compat";
import { Base } from "./iso.js";
import "./styles/root.css";

export const App = () => <Base />;

const app = document.getElementById("app") as HTMLElement;

async function start() {
  const Movies = await lazy(() => import("./pages/movies.js")).preload();
  const Test = await lazy(() => import("./pages/test.js")).preload();
  const Home = await lazy(() => import("./pages/home.js")).preload();
  const result = await prerender(
    <p>
      hello world
      <Home />
      <div>
        <Movies />
      </div>
      <Suspense fallback="loading..">
        <Test />
      </Suspense>
    </p>
  );
  console.log(result);
}

start();

// hydrate(<App />, app);
