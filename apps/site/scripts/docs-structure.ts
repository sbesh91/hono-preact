// apps/site/scripts/docs-structure.ts
// Canonical docs page-structure classifier. Single source of truth for the
// R1/R2/R3 rules, shared by the CI gate (page-structure.test.ts) and the
// authoring hook (docs-template-check.sh). No third-party deps; node runs it
// directly via native TypeScript type-stripping, so the bash hook can shell
// out to it (`node docs-structure.ts <file>`).
import { fileURLToPath } from 'node:url';

export type HeadingKind = 'reference' | 'nuance' | 'example' | 'neutral';
export type StructureProblem = { rule: 'R1' | 'R2' | 'R3'; message: string };

const REFERENCE =
  /^(api reference|api|options|signature|parameters|props|properties|returns)$/;
const NUANCE =
  /^(how it works|known behavior|known limitations|limitations|caveats|gotchas|under the hood)$/;
const EXAMPLE =
  /^(example|demo|usage|basic usage|worked examples|a complete example|recipes|common patterns)$/;

export function classifyHeading(text: string): HeadingKind {
  const h = text.trim().toLowerCase();
  if (REFERENCE.test(h) || h.includes('options reference')) return 'reference';
  if (NUANCE.test(h)) return 'nuance';
  if (EXAMPLE.test(h) || h.startsWith('example:') || h.startsWith('example '))
    return 'example';
  return 'neutral';
}

export function analyzePageStructure(source: string): StructureProblem[] {
  const lines = source.split('\n');
  let inFence = false;
  let firstExample: number | null = null,
    firstNuance: number | null = null,
    firstRef: number | null = null;
  let lastExampleHeading: number | null = null,
    lastNuance: number | null = null;
  let seenH1 = false,
    seenH2 = false,
    hasLead = false;

  for (let i = 0; i < lines.length; i++) {
    const ln = i + 1;
    const raw = lines[i];
    if (/^```/.test(raw)) {
      if (!inFence) {
        inFence = true;
        if (firstExample === null) firstExample = ln;
      } else inFence = false;
      continue;
    }
    if (inFence) continue;
    if (/^<Example/.test(raw)) {
      if (firstExample === null) firstExample = ln;
      continue;
    }
    if (/^# /.test(raw)) {
      seenH1 = true;
      continue;
    }
    if (seenH1 && !seenH2) {
      if (/^## /.test(raw)) seenH2 = true;
      else if (
        !hasLead &&
        !/^\s*$/.test(raw) &&
        !/^import /.test(raw) &&
        !/^#/.test(raw) &&
        !/^</.test(raw)
      )
        hasLead = true;
    }
    const m = /^## (.+)$/.exec(raw);
    if (m) {
      const kind = classifyHeading(m[1]);
      if (kind === 'reference' && firstRef === null) firstRef = ln;
      else if (kind === 'nuance') {
        if (firstNuance === null) firstNuance = ln;
        lastNuance = ln;
      } else if (kind === 'example') lastExampleHeading = ln;
    }
  }

  const problems: StructureProblem[] = [];
  if (!seenH1 || !hasLead)
    problems.push({
      rule: 'R3',
      message:
        'missing an H1 followed by a lead paragraph (what it does and why)',
    });
  if (
    firstNuance !== null &&
    (firstExample === null || firstExample > firstNuance)
  )
    problems.push({
      rule: 'R1',
      message: `nuance heading at line ${firstNuance} precedes the first example (${firstExample ?? 'none'})`,
    });
  if (firstRef !== null && (firstExample === null || firstExample > firstRef))
    problems.push({
      rule: 'R1',
      message: `reference heading at line ${firstRef} precedes the first example (${firstExample ?? 'none'})`,
    });
  if (firstRef !== null) {
    if (lastExampleHeading !== null && lastExampleHeading > firstRef)
      problems.push({
        rule: 'R2',
        message: `example heading at line ${lastExampleHeading} appears after the reference section (line ${firstRef})`,
      });
    if (lastNuance !== null && lastNuance > firstRef)
      problems.push({
        rule: 'R2',
        message: `nuance heading at line ${lastNuance} appears after the reference section (line ${firstRef})`,
      });
  }
  return problems;
}

// --- CLI (hook delegate). Always exits 0; soft-warn only. ---
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { readFileSync } = await import('node:fs');
  for (const file of process.argv.slice(2)) {
    if (file.endsWith('index.mdx')) continue;
    let src: string;
    try {
      src = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    for (const p of analyzePageStructure(src)) {
      process.stderr.write(`${file}: ${p.rule} ${p.message}\n`);
    }
  }
  process.exit(0);
}
