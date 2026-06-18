// Single source of truth for Shiki highlighting on the docs site. Consumed by
// the MDX rehype plugin (fenced code blocks) and by the build-time highlight
// plugin (demo source shown in Code tabs), so both render identically and the
// dark-mode swap in root.css (.shiki / [data-theme='dark']) works for both.
export const SHIKI_THEMES = {
  light: 'github-light',
  dark: 'github-dark',
} as const;

export const SHIKI_DEFAULT_COLOR = 'light';

export const SHIKI_LANGS = [
  'ts',
  'tsx',
  'bash',
  'jsonc',
  'mdx',
  'css',
] as const;

// Options object in the exact shape `@shikijs/rehype` expects.
export const rehypeShikiOptions = {
  themes: SHIKI_THEMES,
  defaultColor: SHIKI_DEFAULT_COLOR,
  langs: [...SHIKI_LANGS],
};
