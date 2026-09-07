// Source-level diagnostics over the user's entry-adjacent files (`api.ts`,
// `app-config.ts`). These sit beside `parser-options.ts` and `ast-walkers.ts`
// rather than inside `server-entry.ts`: they are pure source-in, findings-out
// code-walks with no knowledge of Vite hooks, generated files, or plugin
// state, and the plugin that consumes them is only one possible caller.
//
// Both diagnostics are advisory in the face of a broken file: a parse failure
// here must never be the error the user sees, because the real syntax error
// surfaces from the Vite build itself with a far better message. Where they
// differ is which way they fail (see each function).
import { parse } from '@babel/parser';
import traverse from '@babel/traverse';
import type { NodePath } from '@babel/traverse';
import type { CallExpression, File } from '@babel/types';
import {
  LOADERS_RPC_PATH,
  SOCKETS_RPC_PATH,
} from '@hono-preact/iso/internal/contract';
import { BABEL_PARSER_PLUGINS } from './parser-options.js';

/**
 * The outcome of parsing a user source file for a diagnostic walk.
 *
 * A union rather than `File | null` so the failure arm carries the parser's
 * message: `findApiShadowingRoutes` puts it in the note it prints, and that
 * message is the whole reason the note is useful.
 */
export type DiagnosticParse =
  | { ok: true; ast: File }
  | { ok: false; message: string };

/**
 * Parse a user source file for a diagnostic walk.
 *
 * `errorRecovery` keeps a partially-broken file walkable; the `ok: false` arm
 * is reserved for a failure severe enough that even recovery gave up. Each
 * caller decides what its own diagnostic means in that case, which is why this
 * reports the failure rather than picking a policy.
 */
export function parseDiagnosticSource(source: string): DiagnosticParse {
  try {
    return {
      ok: true,
      ast: parse(source, {
        sourceType: 'module',
        plugins: BABEL_PARSER_PLUGINS,
        errorRecovery: true,
      }),
    };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

export type ApiShadowingRoute =
  | {
      kind: 'wildcard';
      method: string;
      pattern: string;
      line: number | undefined;
      severity: 'error';
    }
  | {
      kind: 'reserved';
      method: string;
      pattern: string;
      line: number | undefined;
      severity: 'error';
    }
  | { kind: 'notFound'; line: number | undefined; severity: 'warning' };

// Framework-reserved request paths. A literal registration of any of these in
// api.ts shadows the framework's RPC handlers now that the user app mounts
// ahead of them.
const RESERVED_PATHS = new Set([LOADERS_RPC_PATH, SOCKETS_RPC_PATH]);

const HONO_METHODS = new Set([
  'get',
  'post',
  'put',
  'patch',
  'delete',
  'options',
  'head',
  'all',
  'on',
]);

const WILDCARD_PATTERNS = new Set(['*', '/*']);

/**
 * Find route registrations in `api.ts` that would shadow the framework's own
 * handlers. Fails *open* (returns no findings) on a parse error, with a note
 * explaining the silence.
 */
export function findApiShadowingRoutes(source: string): ApiShadowingRoute[] {
  const found: ApiShadowingRoute[] = [];

  const parsed = parseDiagnosticSource(source);
  if (!parsed.ok) {
    // If api.ts won't parse, the build will fail elsewhere with a clearer
    // error. Surface a note so the framework user can correlate a missing
    // shadowing warning with a parse-time syntax issue rather than wondering
    // why nothing was reported.
    console.warn(
      `[hono-preact] Failed to parse api.ts for shadowing-route detection: ${parsed.message}. ` +
        `The build will surface the real syntax error; this warning explains why ` +
        `route-overlap diagnostics may be missing.`
    );
    return found;
  }

  traverse(parsed.ast, {
    // Handler bodies are opaque: their contents are user code, not route
    // registrations, so skip every function subtree. This keeps e.g.
    // `c.notFound()` inside a handler from being read as `app.notFound(...)`.
    // (The original walker skipped only a function's `body`; pruning the whole
    // function additionally ignores the absurd case of a route registration in
    // a param default / decorator, which is the safe direction.)
    Function(path) {
      path.skip();
    },
    CallExpression(path: NodePath<CallExpression>) {
      const { node } = path;
      if (
        node.callee.type !== 'MemberExpression' ||
        node.callee.property.type !== 'Identifier'
      ) {
        return;
      }
      const method = node.callee.property.name;
      const line = node.loc?.start.line;

      if (method === 'notFound') {
        found.push({ kind: 'notFound', line, severity: 'warning' });
        return;
      }
      if (!HONO_METHODS.has(method)) return;

      // `app.on(method, path, ...)` puts the path at argument index 1; every
      // other Hono routing method takes the path as argument 0.
      const pathArg = node.arguments[method === 'on' ? 1 : 0];
      if (pathArg?.type !== 'StringLiteral') return;
      if (WILDCARD_PATTERNS.has(pathArg.value)) {
        found.push({
          kind: 'wildcard',
          method,
          pattern: pathArg.value,
          line,
          severity: 'error',
        });
      } else if (RESERVED_PATHS.has(pathArg.value)) {
        found.push({
          kind: 'reserved',
          method,
          pattern: pathArg.value,
          line,
          severity: 'error',
        });
      }
    },
  });
  return found;
}

/**
 * True if the parsed program contains a top-level `export default ...`.
 *
 * The app-config diagnostic uses this to detect a common mistake: writing
 * `export const appConfig = defineApp(...)` instead of
 * `export default defineApp(...)`. Without a default the generated
 * `import appConfig from '...'` binds to undefined and the app-level
 * middleware chain silently never runs.
 *
 * Fails *closed* (returns `true`, i.e. "looks fine") on a parse error, so we
 * do not pile a misleading app-config error on top of an obvious syntax error
 * elsewhere in the file. Note this is the opposite failure direction from
 * `findApiShadowingRoutes`, and deliberately so: that one reports findings, so
 * silence is the safe fallback, while this one reports the *absence* of
 * something, where silence means claiming it was found.
 */
export function hasDefaultExport(source: string): boolean {
  const parsed = parseDiagnosticSource(source);
  if (!parsed.ok) return true;
  for (const node of parsed.ast.program.body) {
    if (node.type === 'ExportDefaultDeclaration') return true;
  }
  return false;
}
