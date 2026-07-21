import type { Middleware } from '../define-middleware.js';
import type { StreamObserver } from '../define-stream-observer.js';

// `StreamObserver<TChunk, TResult>` is invariant in `TResult` (it appears
// in callback arg positions, e.g. `onEnd({ result: TResult })`), so any
// concrete instantiation we declare here would reject sibling observers
// with a different TResult. Classification only reads `__kind` and the
// hook shapes, so we accept the broadest structural form.
export type AnyObserver = StreamObserver<unknown, never>;
export type UseEntry = Middleware | AnyObserver;

const OBSERVER_HOOKS = [
  'onStart',
  'onChunk',
  'onEnd',
  'onError',
  'onAbort',
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * A `use` entry is middleware when it carries the full Middleware contract,
 * not merely the `__kind` brand. `runs` and `fn` are part of the check on
 * purpose: every consumer filters `runs === 'server'` after partitioning, so
 * a typo'd `runs` that passed a brand-only check would still be dropped from
 * the server chain, which is the same fail-open this validation exists to
 * close. A non-function `fn` would otherwise surface as an opaque TypeError
 * from inside the dispatcher.
 */
export function isMiddleware(entry: unknown): entry is Middleware {
  return (
    isRecord(entry) &&
    entry.__kind === 'middleware' &&
    (entry.runs === 'server' || entry.runs === 'client') &&
    typeof entry.fn === 'function'
  );
}

/**
 * Every observer hook is optional, so a hookless `{ __kind: 'observer' }` is
 * valid: that is exactly what `packages/vite/src/guard-strip.ts` inlines in
 * place of a stripped `defineStreamObserver()` call. Hooks that ARE present
 * must be callable, mirroring the `fn` check on middleware.
 */
export function isObserver(entry: unknown): entry is AnyObserver {
  if (!isRecord(entry) || entry.__kind !== 'observer') return false;
  return OBSERVER_HOOKS.every(
    (hook) => entry[hook] === undefined || typeof entry[hook] === 'function'
  );
}

/**
 * Quote a value read off an unclassifiable entry for the diagnostic message.
 * Must be total: it is called with whatever a user module happened to put in
 * `runs` or `__kind`, which can be any JavaScript value.
 *
 * `JSON.stringify` almost gets there, but not quite: it throws on a BigInt
 * (`TypeError: Do not know how to serialize a BigInt`), and it returns
 * `undefined` for a symbol, which would render as the bare text `undefined`
 * and erase the fact that a symbol was there at all. Both are handled before
 * falling back to `JSON.stringify`, which still covers strings (quoted,
 * matching the existing rendering), numbers, booleans, `null`, and plain
 * objects.
 */
function quoteValue(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (typeof value === 'symbol') return String(value);
  if (typeof value === 'bigint') return `${String(value)}n`;
  try {
    const json = JSON.stringify(value);
    return json === undefined ? String(value) : json;
  } catch {
    return String(value);
  }
}

/** Human-readable diagnosis of why an entry is unclassifiable. */
function describeEntry(entry: unknown): string {
  if (entry === null) return 'null';
  if (entry === undefined) return 'undefined';
  if (typeof entry === 'function') return 'a function';
  if (!isRecord(entry)) {
    const rendered = typeof entry === 'string' ? `"${entry}"` : String(entry);
    return `a ${typeof entry} (${rendered})`;
  }
  if (entry.__kind === 'middleware') {
    if (entry.runs !== 'server' && entry.runs !== 'client') {
      return `a middleware whose \`runs\` is ${quoteValue(entry.runs)} (expected 'server' or 'client')`;
    }
    return `a middleware whose \`fn\` is not a function (${typeof entry.fn})`;
  }
  if (entry.__kind === 'observer') {
    const bad = OBSERVER_HOOKS.find(
      (hook) => entry[hook] !== undefined && typeof entry[hook] !== 'function'
    );
    // `bad` is always found here: isObserver only rejects an `observer` for a
    // non-callable hook. The guard keeps the read typed without a cast.
    if (bad === undefined) return 'an observer the framework cannot classify';
    return `an observer whose \`${bad}\` is not a function (${typeof entry[bad]})`;
  }
  if (entry.__kind === undefined) return 'an object with no `__kind`';
  return `an object with \`__kind\` ${quoteValue(entry.__kind)} (expected 'middleware' or 'observer')`;
}

/**
 * Fail closed at the classification boundary. `use` arrays are read
 * structurally off user-defined modules, so an entry the framework cannot
 * classify used to fall through to the observer bucket, and observers do not
 * gate: a malformed auth middleware became a gate that never ran, with no
 * second gate behind it.
 *
 * `source` names the layer the entry came from (e.g. "the app-level `use`"),
 * so `index` locates it in a specific array rather than in a merged chain.
 */
export function assertUseEntry(
  entry: unknown,
  index: number,
  source?: string
): asserts entry is UseEntry {
  if (isMiddleware(entry) || isObserver(entry)) return;
  const where = source ? ` of ${source}` : '';
  throw new Error(
    `Invalid \`use\` entry at index ${index}${where}: ${describeEntry(entry)}. ` +
      'A `use` entry the framework cannot classify would be silently dropped ' +
      'from the middleware chain -- if this is an auth gate, it would not run.'
  );
}
