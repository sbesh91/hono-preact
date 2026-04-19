import { isBrowser } from "./is-browser";

export function importStylesheet(href: string) {
  if (isBrowser() && !document.getElementById(href)) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    link.id = href;
    document.head.appendChild(link);
  }
}

export function inlineStylesheet(promise: Promise<typeof import("*?inline")>) {
  if (isBrowser()) {
    promise.then((mod) => {
      const raw = mod.default;
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(raw);
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
    });
  }
}
