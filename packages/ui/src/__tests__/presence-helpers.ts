import { vi } from 'vitest';

// A controllable stand-in for a CSS Animation. happy-dom has no getAnimations,
// so usePresence finalizes instantly there unless we install fakes like these.
export interface FakeAnimation {
  finished: Promise<void>;
  resolve: () => void;
  reject: (reason?: unknown) => void;
  effect: { getComputedTiming: () => { endTime: number; iterations: number } };
}

export function makeAnimation(
  opts: { endTime?: number; iterations?: number } = {}
): FakeAnimation {
  let resolve!: () => void;
  let reject!: (reason?: unknown) => void;
  const finished = new Promise<void>((res, rej) => {
    resolve = () => res();
    reject = (reason?: unknown) => rej(reason);
  });
  // Swallow rejection so an unresolved/abandoned animation never logs an
  // unhandled rejection in the test runner.
  finished.catch(() => {});
  return {
    finished,
    resolve,
    reject,
    effect: {
      getComputedTiming: () => ({
        endTime: opts.endTime ?? 200,
        iterations: opts.iterations ?? 1,
      }),
    },
  };
}

// Install a getAnimations() on Element.prototype that returns the given fakes.
// Test-only DOM-API stub: the structural mismatch with the real Animation type
// is an accepted mock boundary. Returns a restore() to remove it.
export function installGetAnimations(animations: FakeAnimation[]): () => void {
  const value = vi.fn(() => animations);
  Object.defineProperty(Element.prototype, 'getAnimations', {
    value,
    configurable: true,
    writable: true,
  });
  return () => {
    Reflect.deleteProperty(Element.prototype, 'getAnimations');
  };
}

// Force matchMedia('(prefers-reduced-motion: reduce)') to a fixed result.
export function installReducedMotion(matches: boolean): () => void {
  const original = window.matchMedia;
  Object.defineProperty(window, 'matchMedia', {
    value: (query: string) => ({
      matches,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      onchange: null,
      dispatchEvent: () => false,
    }),
    configurable: true,
    writable: true,
  });
  return () => {
    Object.defineProperty(window, 'matchMedia', {
      value: original,
      configurable: true,
      writable: true,
    });
  };
}
