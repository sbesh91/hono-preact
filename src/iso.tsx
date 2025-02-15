import type { FunctionComponent } from "preact";
import { lazy, LocationProvider, Route, Router } from "preact-iso";
import Movie from "./pages/movie.js";
import Movies from "./pages/movies.js";
import { NotFound } from "./pages/not-found.js";

const Home = lazy(() => import("./pages/home.js"));
const Test = lazy(() => import("./pages/test.js"));

// data loader components double render upon loading
// const Movies = lazy(() => import("./pages/movies.js"));
// const Movie = lazy(() => import("./pages/movie.js"));

export const Base: FunctionComponent = () => {
  return (
    <LocationProvider>
      <Router>
        <Route path="/" component={Home} />
        <Route path="/test" component={Test} />
        <Route path="/movies" component={Movies} />
        <Route path="/movies/:id" component={Movie} />
        <NotFound />
      </Router>
    </LocationProvider>
  );
};
