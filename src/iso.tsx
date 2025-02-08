import type { FC } from "hono/jsx";
import { LocationProvider, Router } from "preact-iso";

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
