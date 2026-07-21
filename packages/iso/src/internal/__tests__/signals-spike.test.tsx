// @vitest-environment happy-dom
// SPIKE (throwaway, not a shipping test): does @preact/signals coexist with the
// pinned preact-iso, whose lazy.js patches options.__b and options.__e for its
// vendored suspense? And does it actually deliver sub-component update
// granularity through the framework's own loader path?
//
// Import order here is: signals first, then preact-iso. The reverse order is
// covered in signals-spike-order.test.tsx.
import { signal } from '@preact/signals';
import { Component, options, hydrate, type VNode } from 'preact';
import { renderToString } from 'preact-render-to-string';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, act } from '@testing-library/preact';
import {
  LocationProvider,
  Router,
  Route,
  lazy,
  ErrorBoundary,
} from 'preact-iso';
import { defineLoader } from '../../define-loader.js';
import { Loader } from '../loader.js';
import { RouteLocationsProvider } from '../route-locations.js';

// preact's Options type does not declare the mangled internal hooks.
type InternalOptions = typeof options & {
  __b?: unknown;
  __e?: unknown;
};

function dripSseResponse(chunks: string[]): Response {
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(enc.encode(chunk));
        await Promise.resolve();
      }
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  // restoreAllMocks does NOT undo vi.stubGlobal('fetch', ...); unstub
  // explicitly or T4's stub leaks into every test after it.
  vi.unstubAllGlobals();
});

describe('T0: options hook chain', () => {
  it('both libraries are installed on the shared options object', () => {
    const o = options as InternalOptions;
    expect(typeof o.__b).toBe('function');
    expect(typeof o.__e).toBe('function');
    expect(typeof options.diffed).toBe('function');
  });
});

describe('T1: update granularity (the actual payoff)', () => {
  it('a signal update patches the DOM WITHOUT re-invoking the component fn', async () => {
    const count = signal(0);
    const renders = vi.fn();

    function Row() {
      renders();
      // Rendering the signal itself (not .value) installs a ReactiveTextNode;
      // reading .value here would subscribe the whole component instead.
      return <p data-testid="row">{count}</p>;
    }

    render(<Row />);
    expect(screen.getByTestId('row').textContent).toBe('0');
    expect(renders).toHaveBeenCalledTimes(1);

    await act(async () => {
      count.value = 1;
    });

    expect(screen.getByTestId('row').textContent).toBe('1');
    // The payoff: DOM updated, component function never re-ran.
    expect(renders).toHaveBeenCalledTimes(1);
  });

  it('contrast: reading .value in the body DOES re-invoke the component', async () => {
    const count = signal(0);
    const renders = vi.fn();

    function Row() {
      renders();
      return <p data-testid="row2">{count.value}</p>;
    }

    render(<Row />);
    expect(renders).toHaveBeenCalledTimes(1);

    await act(async () => {
      count.value = 1;
    });

    expect(screen.getByTestId('row2').textContent).toBe('1');
    expect(renders).toHaveBeenCalledTimes(2);
  });
});

describe('T2: preact-iso vendored suspense coexistence', () => {
  it('a lazy route suspends, resolves, and signals still work inside it', async () => {
    let release!: (v: { default: () => VNode }) => void;
    const pending = new Promise<{ default: () => VNode }>((r) => {
      release = r;
    });

    const inner = signal('before');
    const Lazy = lazy(() => pending);

    render(
      <LocationProvider>
        <Router>
          <Route path="/" component={Lazy} />
        </Router>
      </LocationProvider>
    );

    expect(screen.queryByTestId('lazy')).toBeNull();

    await act(async () => {
      release({ default: () => <p data-testid="lazy">{inner}</p> });
      await pending;
    });

    await waitFor(() => expect(screen.getByTestId('lazy')).toBeTruthy());
    expect(screen.getByTestId('lazy').textContent).toBe('before');

    // A signal bound inside a subtree that was suspended still updates.
    await act(async () => {
      inner.value = 'after';
    });
    expect(screen.getByTestId('lazy').textContent).toBe('after');
  });
});

describe('T3: the thenable path through preact-iso ErrorBoundary', () => {
  // preact-iso's options.__e only intercepts thenables (`err.then`); plain
  // errors fall through to the previous handler. The suspend-catch path is the
  // one the framework depends on, so that is what this asserts.
  it('ErrorBoundary catches a suspend and resumes it with signals loaded', async () => {
    let release!: (v: { default: () => VNode }) => void;
    const pending = new Promise<{ default: () => VNode }>((r) => {
      release = r;
    });
    const onError = vi.fn();
    const Lazy = lazy(() => pending);

    render(
      <ErrorBoundary onError={onError}>
        <Lazy />
      </ErrorBoundary>
    );

    expect(screen.queryByTestId('resumed')).toBeNull();

    await act(async () => {
      release({ default: () => <p data-testid="resumed">ok</p> });
      await pending;
    });

    await waitFor(() => expect(screen.getByTestId('resumed')).toBeTruthy());
    // The suspend was handled as a suspend, never surfaced as an error.
    expect(onError).not.toHaveBeenCalled();
  });

  it('a plain error still reaches a class componentDidCatch', async () => {
    const caught = vi.fn();

    class Boundary extends Component<{ children?: unknown }, { bad: boolean }> {
      state = { bad: false };
      componentDidCatch(err: unknown) {
        caught(err);
        this.setState({ bad: true });
      }
      render() {
        return this.state.bad ? (
          <p data-testid="caught">caught</p>
        ) : (
          (this.props.children as VNode)
        );
      }
    }

    function Boom(): VNode {
      throw new Error('boom');
    }

    render(
      <Boundary>
        <Boom />
      </Boundary>
    );

    await waitFor(() => expect(screen.getByTestId('caught')).toBeTruthy());
    expect((caught.mock.calls[0][0] as Error).message).toBe('boom');
  });
});

describe('T4: framework streaming loader path with signals loaded', () => {
  it('streaming chunks still land through loader.useData()', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          dripSseResponse([
            'data: {"count":1}\n\n',
            'data: {"count":2}\n\n',
            'data: {"count":3}\n\n',
          ])
        )
    );

    const ref = defineLoader<{ count: number }>(async () => ({ count: 0 }), {
      __moduleKey: 'signals-spike-stream',
    });

    function Page() {
      const s = ref.useData();
      // Match on `status`, the primary documented idiom (loading-states.mdx).
      // Only the `loading` arm lacks `data`, so this narrows cleanly and
      // avoids a `data === undefined` presence test.
      if (s.status === 'loading') return <p data-testid="count">pending</p>;
      return <p data-testid="count">{s.data.count}</p>;
    }

    render(
      <LocationProvider>
        <RouteLocationsProvider>
          <Loader
            loader={ref}
            location={{ path: '/', pathParams: {}, searchParams: {} }}
          >
            <Page />
          </Loader>
        </RouteLocationsProvider>
      </LocationProvider>
    );

    await waitFor(() =>
      expect(screen.getByTestId('count').textContent).toBe('3')
    );
  });
});

describe('T5: per-row granularity across a list', () => {
  it('one field changing re-renders zero components', async () => {
    const rows = [signal('a'), signal('b'), signal('c')];
    const rowRenders = [vi.fn(), vi.fn(), vi.fn()];
    const Rows = rows.map((s, i) => () => {
      rowRenders[i]();
      return <li data-testid={`row-${i}`}>{s}</li>;
    });

    function List() {
      return (
        <ul>
          {Rows.map((R, i) => (
            <R key={i} />
          ))}
        </ul>
      );
    }

    render(<List />);
    expect(rowRenders.map((f) => f.mock.calls.length)).toEqual([1, 1, 1]);

    await act(async () => {
      rows[1].value = 'B';
    });

    expect(screen.getByTestId('row-1').textContent).toBe('B');
    // The Linear property: one field changed, zero component re-renders.
    expect(rowRenders.map((f) => f.mock.calls.length)).toEqual([1, 1, 1]);
  });
});

describe('T6: SSR then hydrate', () => {
  it('renders the signal value to string and hydrates without tearing', async () => {
    const name = signal('server');

    function App() {
      return <p data-testid="ssr">{name}</p>;
    }

    const html = renderToString(<App />);
    expect(html).toContain('server');

    const host = document.createElement('div');
    host.innerHTML = html;
    document.body.appendChild(host);
    const textNode = host.querySelector('[data-testid="ssr"]')!.firstChild;

    await act(async () => {
      hydrate(<App />, host);
    });

    expect(host.querySelector('[data-testid="ssr"]')!.textContent).toBe(
      'server'
    );

    await act(async () => {
      name.value = 'client';
    });

    const el = host.querySelector('[data-testid="ssr"]')!;
    expect(el.textContent).toBe('client');
    // Hydration adopted the SSR text node rather than replacing it: proof the
    // signal binding attached to existing DOM instead of forcing a re-create.
    expect(el.firstChild).toBe(textNode);

    host.remove();
  });
});
