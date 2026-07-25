// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, act, cleanup } from '@testing-library/preact';
import { signal } from '@preact/signals';
import { Show } from '../show.js';

afterEach(cleanup);

describe('<Show>', () => {
  it('renders children when truthy, fallback when falsy, and reacts', async () => {
    const when = signal<boolean>(false);
    render(
      <Show when={when} fallback={<span data-testid="fb">empty</span>}>
        <span data-testid="body">shown</span>
      </Show>
    );
    expect(screen.queryByTestId('body')).toBeNull();
    expect(screen.getByTestId('fb')).toBeTruthy();

    await act(async () => {
      when.value = true;
    });
    expect(screen.getByTestId('body')).toBeTruthy();
    expect(screen.queryByTestId('fb')).toBeNull();
  });

  it('passes the narrowed value to a function child', () => {
    const when = signal<{ name: string } | null>({ name: 'ada' });
    render(
      <Show when={when}>{(u) => <span data-testid="n">{u.name}</span>}</Show>
    );
    expect(screen.getByTestId('n').textContent).toBe('ada');
  });

  it('renders nothing by default when falsy', () => {
    const when = signal<number>(0);
    const { container } = render(
      <Show when={when}>
        <span>x</span>
      </Show>
    );
    expect(container.textContent).toBe('');
  });

  it('a signal read inside the function child stays live (per-subtree boundary)', async () => {
    const when = signal(true);
    const count = signal(1);
    render(
      <Show when={when}>
        {() => <span data-testid="c">{count.value}</span>}
      </Show>
    );
    expect(screen.getByTestId('c').textContent).toBe('1');
    await act(async () => {
      count.value = 2;
    });
    expect(screen.getByTestId('c').textContent).toBe('2');
  });

  it('atomic render: a child-internal signal re-renders only the reading component, not a sibling', async () => {
    const when = signal(true);
    const count = signal(0);
    const renders = { reader: 0, sibling: 0 };
    function Reader() {
      renders.reader++;
      return <span data-testid="reader">{count.value}</span>;
    }
    function Sibling() {
      renders.sibling++;
      return <span data-testid="sib">x</span>;
    }
    render(
      <Show when={when}>
        {() => (
          <>
            <Reader />
            <Sibling />
          </>
        )}
      </Show>
    );
    expect(renders).toEqual({ reader: 1, sibling: 1 });

    await act(async () => {
      count.value = 5;
    });
    expect(screen.getByTestId('reader').textContent).toBe('5');
    // Only the component that read `count` re-rendered.
    expect(renders).toEqual({ reader: 2, sibling: 1 });
  });

  it('atomic render: a child-internal signal does NOT re-render <Show> itself', async () => {
    const real = signal(true);
    const count = signal(0);
    let showReads = 0;
    // A custom ReadonlyReactive whose getter counts <Show> renders (it reads
    // `when.value` exactly once per render) and subscribes <Show> to `real`
    // (the real signal is read inside the getter). This is the <Show> analogue
    // of the `by` spy used for <For>: a non-invasive re-render detector through
    // the public `when` prop.
    const when = {
      get value() {
        showReads++;
        return real.value;
      },
    };
    render(
      <Show when={when}>
        {() => <span data-testid="c">{count.value}</span>}
      </Show>
    );
    const afterMount = showReads;
    expect(screen.getByTestId('c').textContent).toBe('0');

    // A child-internal (inline) signal changes: the DOM updates, but <Show>
    // must NOT re-render (the child runs inside its own ShowItem boundary).
    await act(async () => {
      count.value = 5;
    });
    expect(screen.getByTestId('c').textContent).toBe('5');
    expect(showReads).toBe(afterMount);

    // Positive control: toggling the condition DOES re-render <Show>, so the
    // detector is real (a flat count above is meaningful, not vacuous).
    await act(async () => {
      real.value = false;
    });
    expect(showReads).toBeGreaterThan(afterMount);
  });
});
