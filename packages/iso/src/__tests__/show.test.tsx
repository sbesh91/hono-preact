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
});
