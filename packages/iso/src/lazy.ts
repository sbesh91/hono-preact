import type { ComponentType } from 'preact';
import { lazy as preactIsoLazy } from 'preact-iso';

export type LazyComponent<P = {}> = ComponentType<P> & {
  preload: () => Promise<unknown>;
  getResolvedDefault: () => ComponentType | null;
};

type ModuleLike = { default?: ComponentType } | ComponentType;

export function lazy<P = {}>(
  load: () => Promise<ModuleLike>
): LazyComponent<P> {
  let resolved: ComponentType | null = null;
  let modulePromise: Promise<ModuleLike> | null = null;

  // Single source of truth for the import. Side-effect: also caches the
  // resolved default. Returns the original module-like value so callers of
  // preload() see what `load()` actually returned.
  const ensure = (): Promise<ModuleLike> => {
    if (!modulePromise) {
      modulePromise = load().then((m) => {
        const c =
          (m && (m as { default?: ComponentType }).default) ??
          (m as ComponentType);
        resolved = c;
        return m;
      });
    }
    return modulePromise;
  };

  // Hand preact-iso's lazy a stable factory that adapts the module to the
  // {default: Component} shape it expects. This shares `ensure`'s cache, so
  // the underlying load() runs at most once across our preload() callers and
  // preact-iso's own first-render preload.
  const Inner = preactIsoLazy(() =>
    ensure().then((m) => ({
      default:
        (m as { default?: ComponentType }).default ??
        (m as unknown as ComponentType),
    }))
  ) as unknown as LazyComponent<P>;

  Inner.preload = ensure;
  Inner.getResolvedDefault = () => resolved;

  return Inner;
}
