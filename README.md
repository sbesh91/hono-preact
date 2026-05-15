# hono-preact

A monorepo for a Hono + Preact full-stack framework with isomorphic rendering, built on Cloudflare Workers.

## Prerequisites

- [Node.js](https://nodejs.org/)
- [pnpm](https://pnpm.io/) — `npm install -g pnpm`

## Setup

```bash
pnpm install
```

## Development

```bash
pnpm dev
```

Starts the dev server for the `apps/site` project with hot reload.

## Testing

```bash
pnpm test           # run tests once
pnpm test:watch     # run tests in watch mode
pnpm test:coverage  # run tests with coverage report
```

## Building

```bash
pnpm build
```

Builds all packages (`packages/*`) and the app (`apps/site`).

## Deployment

```bash
pnpm deploy
```

Deploys `apps/site` to Cloudflare Workers.

## Project Structure

```
apps/
  site/         # The demo/reference application
packages/
  hono-preact/  # Core framework package
  iso/          # Isomorphic utilities
  server/       # Server-side rendering
  vite/         # Vite plugin
```
