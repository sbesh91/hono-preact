import { createHighlighter, type Highlighter } from 'shiki';
import {
  SHIKI_THEMES,
  SHIKI_DEFAULT_COLOR,
  SHIKI_LANGS,
} from './shiki-config.js';

// Lazily create one highlighter and reuse it across files (creating one per
// call is slow). The promise is cached so concurrent callers share the instance.
let highlighterPromise: Promise<Highlighter> | null = null;
function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: Object.values(SHIKI_THEMES),
      langs: [...SHIKI_LANGS],
    });
  }
  return highlighterPromise;
}

// Highlight a code string to HTML using the shared dual-theme config, so the
// output matches the site's fenced code blocks exactly.
export async function highlightCode(
  code: string,
  lang: string
): Promise<string> {
  const highlighter = await getHighlighter();
  return highlighter.codeToHtml(code, {
    lang,
    themes: SHIKI_THEMES,
    defaultColor: SHIKI_DEFAULT_COLOR,
  });
}
