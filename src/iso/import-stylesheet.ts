export function importStylesheet(href: string) {
  if (typeof document !== "undefined" && !document.getElementById(href)) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    link.id = href;
    document.head.appendChild(link);
  }
}

export function inlineStylesheet(raw: string) {
  if (typeof document !== "undefined") {
    console.log(raw);
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(raw);
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  }
}
