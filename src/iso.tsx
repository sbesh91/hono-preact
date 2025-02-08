import type { FC } from "hono/jsx";
import { LocationProvider, Route, Router } from "preact-iso";
import Home from "./pages/home.js";
import Test from "./pages/test.js";

export const messages = ["Good Morning", "Good Evening", "Good Night"];

export const Layout: FC = (props) => {
  return (
    <html>
      <head></head>
      <body>
        <section id="app">{props.children}</section>
        <script type="module" src="static/client.js"></script>
      </body>
    </html>
  );
};

export const Base: FC = (props) => {
  return (
    <LocationProvider>
      <Router>{props.children}</Router>
    </LocationProvider>
  );
};

export const Routes: FC = () => {
  return (
    <>
      <Route path="/" component={Home} />
      <Route path="/test" component={Test} />
    </>
  );
};
