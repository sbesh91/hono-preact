// Overlay copy of base/src/pages/home.tsx that adds a hono-preact-ui Dialog.
// Overlays are file-granular, so this forks the whole page; keep its loader
// usage and welcome copy in sync with base/src/pages/home.tsx (a parity test
// in __tests__/scaffold.test.ts guards the shared markers).
import { definePage } from 'hono-preact';
import {
  DialogRoot,
  DialogTrigger,
  DialogPopup,
  DialogTitle,
  DialogClose,
} from 'hono-preact-ui';
import { serverLoaders } from './home.server.js';

// `.View(render)` wraps the render in the loader's error boundary and data
// context. `data` is absent only while the loader is cold, so the truthy
// check doubles as the loading guard.
const HomeView = serverLoaders.default.View(({ data }) =>
  data ? (
    <section>
      <h1>Welcome to {'{{name}}'}</h1>
      <p>{data.message}</p>
      <p>
        <small>Rendered at {data.renderedAt}</small>
      </p>
      <DialogRoot>
        <DialogTrigger>Open dialog</DialogTrigger>
        <DialogPopup
          aria-label="Demo dialog"
          style={{
            padding: '1.25rem',
            border: '1px solid #ccc',
            borderRadius: '8px',
            background: 'white',
          }}
        >
          <DialogTitle>hono-preact-ui</DialogTitle>
          <p>This dialog is a headless component from hono-preact-ui.</p>
          <DialogClose>Close</DialogClose>
        </DialogPopup>
      </DialogRoot>
      <p>
        <a href="/about">About</a>
      </p>
    </section>
  ) : (
    <p>Loading...</p>
  )
);

HomeView.displayName = 'Home';

export default definePage(HomeView);
