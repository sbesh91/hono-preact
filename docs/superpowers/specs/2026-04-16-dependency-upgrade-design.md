# Dependency Upgrade — Full Bump (Apr 2026)

## Goal

Upgrade all dependencies to their latest versions, including Vite 7 → 8 and TypeScript 5 → 6.

## Package Changes

### dependencies
| Package | From | To |
|---|---|---|
| `dotenv` | ^17.3.1 | ^17.4.2 |
| `hono` | ^4.11.9 | ^4.12.14 |
| `preact` | ^10.28.3 | ^10.29.1 |

### devDependencies
| Package | From | To | Risk |
|---|---|---|---|
| `@babel/parser` | ^7.29.0 | ^7.29.2 | low |
| `@hono/node-server` | ^1.19.9 | ^1.19.14 | low |
| `@hono/vite-build` | ^1.9.3 | ^1.11.1 | low |
| `@hono/vite-dev-server` | ^0.25.0 | ^0.25.1 | low |
| `@preact/preset-vite` | ^2.10.3 | ^2.10.5 | low |
| `@tailwindcss/postcss` | ^4.1.18 | ^4.2.2 | low |
| `@types/node` | ^24.3.0 | ^25.6.0 | low |
| `miniflare` | ^4.20260219.0 | ^4.20260415.0 | low |
| `postcss` | ^8.5.6 | ^8.5.10 | low |
| `preact-render-to-string` | ^6.6.5 | ^6.6.7 | low |
| `prettier` | ^3.8.1 | ^3.8.3 | low |
| `rollup-plugin-visualizer` | ^7.0.0 | ^7.0.1 | low |
| `sass-embedded` | ^1.97.3 | ^1.99.0 | low |
| `tailwindcss` | ^4.1.18 | ^4.2.2 | low |
| `typescript` | ^5.9.3 | ^6.0.3 | **medium** — major version |
| `vite` | ^7.3.1 | ^8.0.8 | **medium** — major version |
| `wrangler` | ^4.67.0 | ^4.83.0 | low |

## Implementation Steps

1. Update all version ranges in `package.json`
2. Run `npm install` to regenerate `package-lock.json`
3. Run `npx tsc --noEmit` — fix any TypeScript 6 type errors
4. Run `npm run build` — verify full Cloudflare Workers + client build
5. Run `npm run dev` briefly — verify dev server (exercises `@hono/vite-dev-server`)

## Already at Latest (no update needed)

`@babel/types`, `@mdx-js/rollup`, `magic-string`, `remark-gfm`, `tsx`, `hoofd` — all at current latest; not included in the upgrade.

`preact-iso` is a GitHub ref (`github:preactjs/preact-iso#v3`) — not a registry package, not updated here.

`react`, `react-dom`, `react-is` are `npm:@preact/compat` aliases; their version follows `preact` which is bumped above.

## Risk Notes

- **Vite 8**: All plugins (`@preact/preset-vite`, `@hono/vite-build`, `@hono/vite-dev-server`) explicitly support Vite 8 in their peer dependencies. `@mdx-js/rollup` peer dep is `rollup: '>=2'`, compatible with Vite 8's bundled Rollup 4.
- **TypeScript 6**: May introduce stricter type checking or removed APIs. Type errors must be resolved before completion.
- **`@types/node` ^25**: Major bump but project uses standard Node APIs; low real risk.

## Rollback

If build or type-check fails and cannot be quickly resolved, restore via `git checkout package.json package-lock.json` and re-run `npm install`.
