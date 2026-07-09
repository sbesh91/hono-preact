/** Page-layer `use` resolver: matched route path -> its composed `use` chain. */
export type PageUseResolver = (
  path: string
) => ReadonlyArray<unknown> | Promise<ReadonlyArray<unknown>>;

/**
 * Fail closed when a handler is constructed without its page-level `use`
 * resolver. Page-level `use` is where route/layout auth gates live, so an
 * absent resolver would silently drop them on the handler's request path,
 * exposing data the gate should protect. Throwing at construction (rather than
 * dispatching through a guard-less chain) is the single-sourced invariant the
 * loader / action / socket handlers all enforce; consolidating it here keeps
 * the security message and the check from drifting across the three.
 *
 * The `option` string names the handler's specific field (e.g. `resolvePageUse`
 * or `resolvePageUseByPattern`) so the thrown message points at the exact
 * missing option; `surface` names the request path the gate would be dropped on.
 */
export function assertPageUseResolver(
  resolver: unknown,
  ctx: { handler: string; option: string; surface: string }
): asserts resolver is PageUseResolver {
  if (typeof resolver !== 'function') {
    throw new Error(
      `${ctx.handler} requires ${ctx.option}; without it page-level middleware ` +
        `(including auth gates) is silently dropped on the ${ctx.surface}, ` +
        'exposing data the gate should protect. Pass makePageUseResolver(routes).byPattern.'
    );
  }
}
