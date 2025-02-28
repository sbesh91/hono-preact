import type { FunctionComponent } from 'preact';
import { lazy, Route, Router } from 'preact-iso';
import NotFound from './pages/not-found.js';

const Home = lazy(() => import('./pages/home.js'));
const Test = lazy(() => import('./pages/test.js'));
const Movies = lazy(() => import('./pages/movies.js'));
const Movie = lazy(() => import('./pages/movie.js'));

export const Base: FunctionComponent = () => {
  return (
    <Router>
      <Route path="/" component={Home} />
      <Route path="/test" component={Test} />
      <Route path="/movies" component={Movies} />
      <Route path="/movies/:id" component={Movie} />
      <NotFound />
    </Router>
  );
};
