import type { ParserOptions } from '@babel/parser';

/**
 * Shared `@babel/parser` options for every code-walk in this package.
 *
 * Keep this list permissive: we parse user code (`.server.ts`, `routes.ts`,
 * `api.ts`, etc.), not just framework-authored code, so any stage-3 syntax a
 * user might reasonably write should round-trip. A user who writes
 * `class Foo { @inject() bar }` or `import data from './x.json' with { type: 'json' }`
 * should not get a silent code-walk failure where the framework expected to
 * find a `defineLoader(...)` call and ran past it.
 *
 * Import attributes (`with { ... }`) and explicit resource management
 * (`using` / `await using`) parse by default in Babel 8, so they no longer
 * need dedicated plugins; the syntaxes above still round-trip without them.
 *
 * Each call site adds `sourceType: 'module'` and `errorRecovery: true`
 * separately because both are universal at our call sites and the
 * `ParserOptions` shape carries them as top-level fields.
 */
export const BABEL_PARSER_PLUGINS: ParserOptions['plugins'] = [
  'typescript',
  'jsx',
  'decorators',
  'decoratorAutoAccessors',
];
