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
  const { message, renderedAt } = homeLoader.useData();
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

const HomeView = homeLoader.View(() => <HomePage />, {
  fallback: <p>Loading...</p>,
});

export default definePage(HomeView, {});
