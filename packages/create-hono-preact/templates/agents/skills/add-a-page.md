# Add a page

**Use this when:** you need a new URL that renders a Preact component.

## Mental model (read first)

- Routes are declared in code in `src/routes.ts`, not by file location. There is no
  filesystem routing; a file under `src/pages/` does nothing until you register it.
- This is Preact, not React. Import hooks from `preact/hooks` and types from `preact`.
- A page that needs no server data is just a component with a `default` export. Adding
  data is a separate step (see `add-a-loader.md`); adding a mutation is another (see
  `add-an-action.md`).

## Steps

1. Create the component at `src/pages/<name>.tsx` (replace `<name>`):

   ```tsx
   import type { FunctionComponent } from 'preact';

   const About: FunctionComponent = () => (
     <section>
       <h1>About</h1>
       <p>This page is rendered by hono-preact.</p>
       <a href="/">Home</a>
     </section>
   );
   About.displayName = 'About';

   export default About;
   ```

2. Register the route in `src/routes.ts` by adding an entry to the `routeTree` array
   (the scaffold declares it `as const` so route params and paths stay typed). The
   import specifier ends in `.js`, not `.tsx`:

   ```ts
   { path: '/about', view: () => import('./pages/about.js') },
   ```

3. Confirm `src/Layout.tsx` renders both `<ClientScript />` and `<Head />` (both from
   `hono-preact`). The scaffold's layout already does; a hand-written one must:

   ```tsx
   import { ClientScript, Head } from 'hono-preact';
   // ...inside the returned document...
   <Head defaultTitle="My app" />
   // ...near the end of <body>...
   <ClientScript />
   ```

## Verify

- Run `pnpm typecheck`. It must pass.
- Run `pnpm dev` and open the new path (for example `http://localhost:5173/about`). The
  page renders, and links work (which proves hydration ran).

## Common mistakes

- Importing the view with the wrong extension. Route imports use `.js`
  (`import('./pages/about.js')`) even though the file is `about.tsx`. A `.tsx` or
  extensionless specifier will not resolve.
- Creating the file but never registering it. There is no filesystem routing, so an
  unregistered page is a 404.
- A layout missing `<ClientScript />`. The page renders on the server but is dead in the
  browser. `<Head />` must be present too.
- Reaching for React. Import from `preact` / `preact/hooks`, never `react`.

## Reference

- Routing in depth: see "Adding Pages" and "The Route Table" in `../llms-full.txt`.
- Framework conventions: `../../AGENTS.md`.
