// Overlay copy of base/src/pages/home.tsx that adds a hono-preact-ui Dialog.
// Overlays are file-granular, so this forks the whole page; keep its loader
// usage and welcome copy in sync with base/src/pages/home.tsx (a parity test in
// __tests__/scaffold.test.ts guards the shared markers).
import { definePage } from 'hono-preact';
import type { FunctionComponent } from 'preact';
import {
  DialogRoot,
  DialogTrigger,
  DialogPopup,
  DialogTitle,
  DialogClose,
} from 'hono-preact-ui';
import { serverLoaders } from './home.server.js';

const homeLoader = serverLoaders.default;

const HomePage: FunctionComponent = () => {
  const s = homeLoader.useData();
  if (s.status === 'loading') return <p>Loading...</p>;
  const { message, renderedAt } = s.data;
  return (
    <section>
      <h1>Welcome to {'{{name}}'}</h1>
      <p>{message}</p>
      <p>
        <small>Rendered at {renderedAt}</small>
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
  );
};
HomePage.displayName = 'HomePage';

const HomeView = homeLoader.View((s) =>
  s.status === 'loading' ? <p>Loading...</p> : <HomePage />
);

export default definePage(HomeView, {});
