import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { compress } from "hono/compress";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { prerender } from "preact-iso";
import { env } from "./iso/is-browser.js";
import { Layout } from "./server/layout.js";
import { location } from "./server/middleware/location.js";
import { getMovie, getMovies } from "./server/movies.js";

const port = 3000;
export const app = new Hono();

const key = readFileSync(resolve("./.env")).toString();
process.env.API_KEY = key;

env.current = "server";

app
  .use(compress())
  .use(
    "/static/*",
    serveStatic({
      root: "./src",
      rewriteRequestPath: (path) => path.replace(/^\/static/, "./public"),
    })
  )
  .get("/api/movies", async (c) => {
    const movies = await getMovies();
    return c.json(movies);
  })
  .get("/api/movies/:id", async (c) => {
    const movie = await getMovie(c.req.param("id"));
    return c.json(movie);
  })
  .use(location)
  .get("*", async (c) => {
    const { html } = await prerender(<Layout context={c} />);
    return c.html(`<!DOCTYPE html>${html}`);
  });

console.log(`Server is running on http://localhost:${port}`);

serve({
  fetch: app.fetch,
  port,
});
