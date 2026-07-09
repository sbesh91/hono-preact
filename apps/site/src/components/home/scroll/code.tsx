import type { ComponentChild, VNode } from 'preact';

// Lightweight highlighter for the short, fixed snippets shown in the home
// chapters. It is deliberately conservative (comments, strings, keywords, and
// call-site function names only) so it can never mis-color running text; the
// token colors are the wire tokens, already AA on the code surface in both
// themes. This ships instead of a real highlighter because every snippet is a
// handful of static lines.
const KEYWORDS = new Set([
  'const',
  'let',
  'var',
  'export',
  'default',
  'async',
  'await',
  'function',
  'return',
  'switch',
  'case',
  'while',
  'for',
  'of',
  'in',
  'new',
  'yield',
  'import',
  'from',
  'if',
  'else',
]);

// Highlight identifiers (keywords / call names) inside a run with no strings.
function pushPlain(run: string, out: ComponentChild[]): void {
  const re = /([A-Za-z_$][\w$]*)(\s*\()?|([^A-Za-z_$]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(run))) {
    if (m[1] !== undefined) {
      const word = m[1];
      const paren = m[2] ?? '';
      if (KEYWORDS.has(word)) out.push(<span class="tok-kw">{word}</span>);
      else if (paren) out.push(<span class="tok-fn">{word}</span>);
      else out.push(word);
      if (paren) out.push(paren);
    } else if (m[3] !== undefined) {
      out.push(m[3]);
    }
  }
}

function tokenizeLine(line: string): ComponentChild[] {
  const out: ComponentChild[] = [];
  // Trailing line comment. None of the snippets contain `//` inside a string,
  // so the first occurrence always starts a comment.
  const cIdx = line.indexOf('//');
  const code = cIdx >= 0 ? line.slice(0, cIdx) : line;
  const comment = cIdx >= 0 ? line.slice(cIdx) : '';

  // Split the code portion into string literals versus the rest.
  const strRe = /('[^']*'|`[^`]*`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = strRe.exec(code))) {
    if (m.index > last) pushPlain(code.slice(last, m.index), out);
    out.push(<span class="tok-str">{m[0]}</span>);
    last = m.index + m[0].length;
  }
  if (last < code.length) pushPlain(code.slice(last), out);
  if (comment) out.push(<span class="tok-cm">{comment}</span>);
  return out;
}

export function Code({ source }: { source: string }): VNode {
  const children: ComponentChild[] = [];
  source.split('\n').forEach((line, i) => {
    if (i > 0) children.push('\n');
    children.push(...tokenizeLine(line));
  });
  return <code>{children}</code>;
}
