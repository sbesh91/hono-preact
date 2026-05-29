// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { render, cleanup } from '@testing-library/preact';
import { Persist, PersistHost } from '../persist.js';
import { __persistRegistryResetForTesting } from '../internal/persist-registry.js';

describe('Persist + PersistHost', () => {
  beforeEach(() => {
    cleanup();
    __persistRegistryResetForTesting();
  });

  it('Persist alone renders nothing inline on the client (registry-only)', () => {
    const { container } = render(
      <div data-page>
        <Persist id="player">
          <span data-id="audio">a</span>
        </Persist>
      </div>
    );
    // On the client, Persist contributes no inline DOM. The audio span
    // only appears when a PersistHost is mounted to render the registry entry.
    expect(container.querySelector('[data-page] [data-id="audio"]')).toBeNull();
  });

  it('PersistHost renders entries from the registry', () => {
    render(
      <div>
        <Persist id="player">
          <span data-id="audio">a</span>
        </Persist>
        <PersistHost />
      </div>
    );

    // After Persist mounts, the registry has an entry; PersistHost renders it.
    const hosts = document.querySelectorAll('[data-hp-persist-slot]');
    expect(hosts.length).toBe(1);
    expect(hosts[0].getAttribute('data-hp-persist-slot')).toBe('player');
    expect(hosts[0].textContent).toBe('a');
  });

  it('applies viewTransitionName to the slot host element', () => {
    render(
      <div>
        <Persist id="player" viewTransitionName="player-shell">
          <span>a</span>
        </Persist>
        <PersistHost />
      </div>
    );
    const host = document.querySelector(
      '[data-hp-persist-slot="player"]'
    ) as HTMLElement;
    expect(host.style.getPropertyValue('view-transition-name')).toBe(
      'player-shell'
    );
  });

  it('updates registry when children change', () => {
    const { rerender } = render(
      <div>
        <Persist id="player">
          <span>a</span>
        </Persist>
        <PersistHost />
      </div>
    );
    let host = document.querySelector(
      '[data-hp-persist-slot="player"]'
    ) as HTMLElement;
    expect(host.textContent).toBe('a');

    rerender(
      <div>
        <Persist id="player">
          <span>b</span>
        </Persist>
        <PersistHost />
      </div>
    );
    host = document.querySelector(
      '[data-hp-persist-slot="player"]'
    ) as HTMLElement;
    expect(host.textContent).toBe('b');
  });

  it('does NOT clear the registry entry when Persist unmounts', () => {
    const { rerender } = render(
      <div>
        <Persist id="player">
          <span>a</span>
        </Persist>
        <PersistHost />
      </div>
    );
    expect(
      document.querySelector('[data-hp-persist-slot="player"]')
    ).not.toBeNull();

    rerender(
      <div>
        <PersistHost />
      </div>
    );
    // Persist unmounted; the host should still render the last entry.
    const host = document.querySelector(
      '[data-hp-persist-slot="player"]'
    ) as HTMLElement;
    expect(host).not.toBeNull();
    expect(host.textContent).toBe('a');
  });
});
