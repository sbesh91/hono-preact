import type { FunctionComponent } from "preact";
import { lazy, LocationProvider, Route, Router } from "preact-iso";

const Home = lazy(() => import("./pages/home.js"));
const Test = lazy(() => import("./pages/test.js"));
const Movies = lazy(() => import("./pages/movies.js"));

export const Base: FunctionComponent<{ url?: string }> = (props) => {
  return (
    <LocationProvider>
      <Router url={props.url}>
        <Route path="/" component={Home} />
        <Route path="/test" component={Test} />
        <Route path="/movies" component={Test} />
      </Router>
    </LocationProvider>
  );
};
