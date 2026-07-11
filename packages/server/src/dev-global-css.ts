// Dev-only delivery of the framework-owned global stylesheet. In `vite dev`
// there is no client build, so the preload artifact has no globalCss; the
// generated core app (serve mode only) installs the source URL(s) here and
// renderPage injects them ahead of any artifact values. Prod never installs
// this (the codegen omits the call outside serve), so it stays undefined.

let devGlobalCss: string[] | undefined;

export function installDevGlobalCss(urls: readonly string[]): void {
  devGlobalCss = [...urls];
}

export function getDevGlobalCss(): readonly string[] | undefined {
  return devGlobalCss;
}

/** Test-only. */
export function __resetDevGlobalCssForTests(): void {
  devGlobalCss = undefined;
}
