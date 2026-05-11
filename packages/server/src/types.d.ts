// Vite injects `import.meta.env.*` at build time; declare the minimum subset
// we use here so the server package can be typechecked without depending on
// vite/client (vite is a build-time concern, not a runtime concern of this
// package).
interface ImportMetaEnv {
  readonly DEV: boolean;
  readonly PROD: boolean;
  readonly MODE: string;
  readonly SSR: boolean;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
