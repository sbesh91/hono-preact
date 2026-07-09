// Build-time CSS auto-split (issue #249 Layer 3): tree-shake the app's global
// stylesheet into per-chunk sheets by class-name usage evidence. See
// docs/superpowers/specs/2026-07-09-css-auto-split-design.md.
//
// Safety invariant: a rule that cannot be PROVEN exclusive to one scopable
// chunk stays in the residual global sheet. Splitting is an optimization,
// never a correctness risk; nothing is ever dropped ("unused" CSS is not
// purged, it stays global).
//
// Emitted-sheet byte size is not a strict tally of applied rules: Lightning
// CSS's minifier keeps an emptied @media/@layer wrapper as `{}` rather than
// pruning it once every rule inside is scoped away (see emitSubset below).
// That is a bytes-only quirk, not a correctness gap.

import { transform } from 'lightningcss';
import type { Targets } from 'lightningcss';
import { entryClosure } from './route-preload.js';
import type {
  RouteBundleChunkLike,
  RouteModuleChain,
} from './route-preload.js';

/** One JS chunk's usage evidence for class scanning. */
export interface CssChunkEvidence {
  fileName: string;
  code: string;
  /**
   * Whether the chunk may OWN scoped CSS: it appears in some route chain and
   * is not part of the entry closure. Non-scopable chunks still count as
   * evidence (a class they contain is not exclusive elsewhere), but CSS scoped
   * to them would never be delivered (synthesized sheets ride the route-chain
   * maps only), so their rules stay global.
   */
  scopable: boolean;
}

// The structural subset of Lightning CSS's selector AST this module reads.
// Components are e.g. {type:'class', name} or {type:'pseudo-class', kind,
// selectors} for functional pseudo-classes (:is/:not/:where/:has). Most of
// those carry `selectors` as a list of alternatives (one Selector per
// argument, comma-separated); `:host(<selector>)` is the one exception,
// carrying a single flat Selector (or null) instead of a list, so the field
// here is typed to admit either shape.
interface SelectorComponentLike {
  type: string;
  name?: string;
  selectors?: SelectorComponentLike[][] | SelectorComponentLike[] | null;
}
export type SelectorListLike = SelectorComponentLike[][];

// `:host(<selector>)` is the one functional pseudo-class whose `selectors`
// is a single flat Selector rather than a list of alternatives. Distinguish
// the two shapes by inspecting the first element: a list of alternatives
// nests one level deeper (its first element is itself an array).
function isSelectorList(
  value: SelectorComponentLike[][] | SelectorComponentLike[]
): value is SelectorComponentLike[][] {
  return value.length === 0 || Array.isArray(value[0]);
}

function asNestedSelectorLists(
  value: SelectorComponentLike[][] | SelectorComponentLike[]
): SelectorComponentLike[][] {
  return isSelectorList(value) ? value : [value];
}

/**
 * Walk one selector list. `anchored` is true when EVERY selector in the list
 * has at least one class outside functional pseudo-class arguments (an element
 * matching it must carry that class); `classes` is every class name mentioned
 * anywhere, including inside :is()/:not()/etc (all must pass the exclusivity
 * check, the conservative direction).
 */
export function analyzeSelectorList(selectors: SelectorListLike): {
  anchored: boolean;
  classes: string[];
} {
  const classes = new Set<string>();
  let anchored = true;
  for (const selector of selectors) {
    let anchor = false;
    for (const component of selector) {
      if (component.type === 'class' && component.name != null) {
        anchor = true;
        classes.add(component.name);
      } else if (component.selectors) {
        for (const nested of asNestedSelectorLists(component.selectors)) {
          collectNestedClasses(nested, classes);
        }
      }
    }
    if (!anchor) anchored = false;
  }
  return { anchored, classes: [...classes] };
}

function collectNestedClasses(
  selector: SelectorComponentLike[],
  out: Set<string>
): void {
  for (const component of selector) {
    if (component.type === 'class' && component.name != null) {
      out.add(component.name);
    } else if (component.selectors) {
      for (const nested of asNestedSelectorLists(component.selectors)) {
        collectNestedClasses(nested, out);
      }
    }
  }
}

/** Decide which chunk (if any) exclusively owns every class of a rule. */
function decideOwner(
  selectors: SelectorListLike,
  chunks: readonly CssChunkEvidence[]
): string | null {
  const { anchored, classes } = analyzeSelectorList(selectors);
  if (!anchored || classes.length === 0) return null;
  let owner: CssChunkEvidence | undefined;
  for (const cls of classes) {
    // Plain substring scan: catches JSX literals, clsx args, and classes inside
    // embedded HTML strings. False positives only WIDEN apparent usage, which
    // demotes toward global (the safe direction).
    const containing = chunks.filter((c) => c.code.includes(cls));
    if (containing.length !== 1) return null;
    const found = containing[0];
    if (!found.scopable) return null;
    if (owner && owner !== found) return null;
    owner = found;
  }
  return owner ? owner.fileName : null;
}

/**
 * Attribution pass: one Lightning CSS traversal assigning each TOP-LEVEL style
 * rule an owner (`null` = residual global). Nested style rules (CSS nesting)
 * follow their parent, so they get no index of their own. Also collects the
 * top-level cascade-layer order (statements and blocks, first-seen), which the
 * residual re-declares so scoping a whole @layer block cannot reorder layers.
 */
export function attributeRules(
  cssCode: string,
  chunks: readonly CssChunkEvidence[],
  targets: Targets | undefined
): { owners: Array<string | null>; layerNames: string[] } {
  const owners: Array<string | null> = [];
  const layerNames: string[] = [];
  const seenLayers = new Set<string>();
  const pushLayer = (name: string): void => {
    if (seenLayers.has(name)) return;
    seenLayers.add(name);
    layerNames.push(name);
  };
  let styleDepth = 0;
  let atDepth = 0;
  transform({
    filename: 'global.css',
    code: Buffer.from(cssCode),
    minify: false,
    targets,
    visitor: {
      Rule: {
        style(rule) {
          if (styleDepth === 0) {
            owners.push(decideOwner(rule.value.selectors, chunks));
          }
          styleDepth++;
          return rule;
        },
        media(rule) {
          atDepth++;
          return rule;
        },
        supports(rule) {
          atDepth++;
          return rule;
        },
        'layer-block'(rule) {
          if (atDepth === 0 && rule.value.name)
            pushLayer(rule.value.name.join('.'));
          atDepth++;
          return rule;
        },
        'layer-statement'(rule) {
          if (atDepth === 0) {
            for (const name of rule.value.names) pushLayer(name.join('.'));
          }
          return rule;
        },
      },
      // Flat form (not the per-type mapped form used for `Rule` above): a
      // mapped `RuleExit: { style(...), media(...), ... }` never invokes its
      // callbacks against the installed lightningcss (verified against
      // 1.32.0 with an isolated probe), so exits would never fire and the
      // depth counters would only ever grow. The flat single-function form
      // does fire for every rule type, entry and exit alike, so it is used
      // here and switches on `rule.type` instead.
      //
      // Return `undefined` (a no-op), never the unmodified `rule`: this pass
      // only tracks depth counters here and never needs to replace a rule at
      // exit, and returning an unmodified rule for some at-rule shapes (e.g.
      // @font-face's `src` list) corrupts serialization (verified with an
      // isolated probe: Lightning CSS throws "failed to deserialize;
      // expected an object-like struct named FontFormat, found ()").
      RuleExit(rule) {
        switch (rule.type) {
          case 'style':
            styleDepth--;
            break;
          case 'media':
          case 'supports':
          case 'layer-block':
            atDepth--;
            break;
        }
        return undefined;
      },
    },
  });
  return { owners, layerNames };
}

export interface CssSplitOptions {
  /** Minimum emitted-sheet byte size; smaller scoped sets stay global. */
  minSize: number;
  targets?: Targets;
}

export interface CssSplitResult {
  /** Residual global CSS (minified; layer order re-declared at its head). */
  residual: string;
  /** Owning chunk fileName -> that chunk's scoped CSS (minified). */
  perChunk: Map<string, string>;
}

interface EmitResult {
  code: string;
  /** UTF-8 byte length of `code` (minSize compares bytes, not code units). */
  bytes: number;
  visited: number;
  kept: number;
}

// At-rule types that can WRAP top-level-indexed style rules. These survive in
// every emission (their style children are filtered normally). Every other
// non-style rule type (@keyframes, @font-face, @property, @counter-style,
// @page, @import, unknown/custom at-rules, ...) is a leaf that cannot own
// scoped styles, so it lands ONLY in the residual: per-chunk emissions drop it
// to avoid shipping a duplicate copy per sheet.
const CONTAINER_RULE_TYPES: ReadonlySet<string> = new Set([
  'media',
  'supports',
  'layer-block',
  'container',
  'scope',
  'starting-style',
  'moz-document',
]);

/**
 * Emission pass: re-serialize the monolith keeping only the top-level style
 * rules `keep` accepts. Style-rule drops happen at RuleExit (enter/exit
 * pairing is guaranteed when enter never replaces), so nested traversal and
 * index order stay identical to the attribution pass. Container at-rule
 * wrappers survive around kept rules; emptied wrappers are pruned by
 * minification EXCEPT for at-rules whose grammar still requires a body
 * (verified with an isolated probe: an emptied @media or @layer block is
 * retained as an empty `{}` wrapper by Lightning CSS's minifier). That is a
 * bytes-only quirk, not a correctness gap, since an empty wrapper applies no
 * rules; callers should not assert emptied wrappers vanish entirely.
 *
 * Non-container leaf at-rules stay residual-only: `scoped` emissions drop them
 * (guarded to styleDepth 0, so rule types that legally nest inside style
 * rules, e.g. nested-declarations, always follow their parent untouched).
 *
 * Layer statements: per-chunk emissions drop them all; the residual drops only
 * TOP-LEVEL ones (its prefix re-declares those names) and keeps nested ones
 * (e.g. `@media{@layer x;}`) in place, since the prefix does not cover them.
 *
 * RuleExit uses the flat form for a second reason beyond the one documented on
 * attributeRules above: returning an unmodified `rule` object from an
 * ancestor's exit, after one of its descendants was already dropped at ITS
 * exit, corrupts serialization (verified with an isolated probe: Lightning
 * CSS throws "missing field `value`") because the returned copy of the
 * ancestor no longer matches its already-mutated internal tree. The fix is to
 * never re-return an unmodified rule from RuleExit: return `[]` to drop, and
 * `undefined` (a no-op, keeping the library's own already-updated tree)
 * otherwise, for every rule type including the kept 'style' case.
 */
function emitSubset(
  cssCode: string,
  owners: ReadonlyArray<string | null>,
  keep: (owner: string | null) => boolean,
  scoped: boolean,
  targets: Targets | undefined
): EmitResult {
  let styleDepth = 0;
  let atDepth = 0;
  let index = 0;
  let visited = 0;
  let kept = 0;
  const dropStack: boolean[] = [];
  const enterContainer = (): undefined => {
    atDepth++;
    return undefined;
  };
  const result = transform({
    filename: 'global.css',
    code: Buffer.from(cssCode),
    minify: true,
    targets,
    visitor: {
      Rule: {
        style(rule) {
          let drop = false;
          if (styleDepth === 0) {
            visited++;
            const owner = owners[index];
            index++;
            drop = !keep(owner ?? null);
            if (!drop) kept++;
          }
          dropStack.push(drop);
          styleDepth++;
          return rule;
        },
        media: enterContainer,
        supports: enterContainer,
        'layer-block': enterContainer,
        container: enterContainer,
        scope: enterContainer,
        'starting-style': enterContainer,
        'moz-document': enterContainer,
        'layer-statement'() {
          // Dropping a leaf at enter is safe (nothing nests under it, so no
          // enter/exit pairing to preserve). Nested statements survive in the
          // residual because the prefix only re-declares top-level names.
          if (scoped || atDepth === 0) return [];
          return undefined;
        },
      },
      RuleExit(rule) {
        if (rule.type === 'style') {
          styleDepth--;
          const drop = dropStack.pop();
          if (drop) return [];
          return undefined;
        }
        if (CONTAINER_RULE_TYPES.has(rule.type)) {
          atDepth--;
          return undefined;
        }
        // Leaf at-rule: residual-only. The styleDepth guard keeps rule types
        // that live inside style rules attached to their parent.
        if (scoped && styleDepth === 0) return [];
        return undefined;
      },
    },
  });
  return {
    code: result.code.toString(),
    bytes: result.code.length,
    visited,
    kept,
  };
}

/**
 * A rule was dropped or double-counted during splitting. Unlike every other
 * split failure (which degrades to delivering the sheet unsplit), this one
 * must FAIL THE BUILD: the splitter's own accounting is broken, so no split
 * output can be trusted. `applyCssAutoSplit` rethrows it by type, never by
 * message sniffing.
 */
export class CssSplitConservationError extends Error {}

function assertConservation(
  label: string,
  visited: number,
  total: number
): void {
  if (visited !== total) {
    throw new CssSplitConservationError(
      `[hono-preact] css auto-split conservation check failed for ${label}: ` +
        `visited ${visited} top-level style rules, expected ${total}. ` +
        `No split output was trusted; this is a splitter bug, please report it.`
    );
  }
}

/**
 * Split one global stylesheet into a residual plus per-chunk scoped sheets.
 * Throws on a conservation mismatch (a rule dropped or double-counted would
 * otherwise ship a broken page); callers turn that into a build failure.
 */
export function splitCssByChunkUsage(
  cssCode: string,
  chunks: readonly CssChunkEvidence[],
  opts: CssSplitOptions
): CssSplitResult {
  const { owners, layerNames } = attributeRules(cssCode, chunks, opts.targets);
  const total = owners.length;

  const owningChunks = [
    ...new Set(owners.filter((o): o is string => o !== null)),
  ];
  const demoted = new Set<string>();
  const perChunk = new Map<string, string>();
  let scopedKept = 0;
  for (const owner of owningChunks) {
    const out = emitSubset(
      cssCode,
      owners,
      (o) => o === owner,
      true,
      opts.targets
    );
    assertConservation(owner, out.visited, total);
    if (out.bytes < opts.minSize) {
      demoted.add(owner);
      continue;
    }
    scopedKept += out.kept;
    perChunk.set(owner, out.code);
  }

  const residualOut = emitSubset(
    cssCode,
    owners,
    (o) => o === null || demoted.has(o),
    false,
    opts.targets
  );
  assertConservation('residual', residualOut.visited, total);
  if (residualOut.kept + scopedKept !== total) {
    throw new CssSplitConservationError(
      `[hono-preact] css auto-split conservation check failed: ` +
        `${residualOut.kept} residual + ${scopedKept} scoped rules != ${total} input rules.`
    );
  }

  // Re-declare the monolith's top-level layer order first, so scoping an
  // entire @layer block into a route sheet cannot reorder cascade layers
  // (layer order is fixed by first declaration; later re-declarations are
  // no-ops, so this is also safe when the residual kept some blocks).
  const layerPrefix =
    layerNames.length > 0 ? `@layer ${layerNames.join(',')};` : '';
  return { residual: layerPrefix + residualOut.code, perChunk };
}

/** Bundle entries as this module reads them: chunks carry code, assets a source. */
export interface SplitBundleEntryLike extends RouteBundleChunkLike {
  code?: string;
  source?: string | Uint8Array;
}

export interface CssAutoSplitBundleOptions {
  autoSplit: boolean;
  minSize: number;
  targets?: Targets;
  emitFile: (asset: { type: 'asset'; name: string; source: string }) => string;
  getFileName: (ref: string) => string;
  warn: (msg: string) => void;
  /**
   * Splitter override for tests (defaults to {@link splitCssByChunkUsage}),
   * so both failure-policy branches (conservation rethrow vs warn-and-degrade)
   * are exercisable without crafting CSS that breaks the real splitter.
   */
  split?: typeof splitCssByChunkUsage;
}

function assetSource(entry: SplitBundleEntryLike): string | undefined {
  if (typeof entry.source === 'string') return entry.source;
  if (entry.source instanceof Uint8Array)
    return new TextDecoder().decode(entry.source);
  return undefined;
}

/**
 * Split every CSS asset the client entry chunk imports (the framework-owned
 * global stylesheet, plus anything else entry-imported) against the bundle's
 * usage evidence, wiring per-chunk sheets into `viteMetadata.importedCss` so
 * the existing `resolveRouteCssMap` union delivers them per route. Returns the
 * residual sheet URLs for the artifact's `globalCss`.
 *
 * Failure policy per the spec: a conservation mismatch THROWS (the caller
 * fails the build; a dropped rule is a broken page). Any other per-asset
 * failure warns and degrades to delivering that asset unsplit.
 */
export function applyCssAutoSplit(
  bundle: Record<string, SplitBundleEntryLike>,
  chains: readonly RouteModuleChain[],
  chunksOf: (src: string) => ReadonlySet<string>,
  opts: CssAutoSplitBundleOptions
): string[] {
  const entry = Object.values(bundle).find(
    (c) => c.isEntry && c.type !== 'asset'
  );
  const entryCssFiles = [...(entry?.viteMetadata?.importedCss ?? [])];
  if (entryCssFiles.length === 0) return [];

  if (!opts.autoSplit) return entryCssFiles.map((f) => '/' + f);

  const eager = entryClosure(bundle);
  const scopable = new Set<string>();
  for (const chain of chains) {
    for (const src of chain.sources) {
      for (const file of chunksOf(src)) {
        if (!eager.has(file)) scopable.add(file);
      }
    }
  }
  const evidence: CssChunkEvidence[] = [];
  for (const c of Object.values(bundle)) {
    if (c.type === 'asset' || typeof c.code !== 'string') continue;
    evidence.push({
      fileName: c.fileName,
      code: c.code,
      scopable: scopable.has(c.fileName),
    });
  }

  const globalCss: string[] = [];
  for (const cssFile of entryCssFiles) {
    const asset = bundle[cssFile];
    const source = asset ? assetSource(asset) : undefined;
    if (source === undefined) {
      opts.warn(
        `css auto-split: entry stylesheet ${cssFile} unreadable; delivering it unsplit`
      );
      globalCss.push('/' + cssFile);
      continue;
    }
    let split: CssSplitResult;
    try {
      split = (opts.split ?? splitCssByChunkUsage)(source, evidence, {
        minSize: opts.minSize,
        targets: opts.targets,
      });
    } catch (e) {
      // Conservation failures must fail the build (spec); rethrow for the
      // plugin to turn into this.error. Anything else degrades to unsplit.
      if (e instanceof CssSplitConservationError) throw e;
      opts.warn(
        `css auto-split: could not split ${cssFile} (${e instanceof Error ? e.message : String(e)}); delivering it unsplit`
      );
      globalCss.push('/' + cssFile);
      continue;
    }

    for (const [ownerFile, css] of split.perChunk) {
      const base = ownerFile.replace(/^.*\//, '').replace(/\.js$/, '');
      const ref = opts.emitFile({
        type: 'asset',
        name: `${base}.scoped.css`,
        source: css,
      });
      const emittedFile = opts.getFileName(ref);
      const owner = bundle[ownerFile];
      if (!owner) continue;
      owner.viteMetadata ??= { importedCss: new Set<string>() };
      owner.viteMetadata.importedCss ??= new Set<string>();
      owner.viteMetadata.importedCss.add(emittedFile);
    }

    const residualRef = opts.emitFile({
      type: 'asset',
      name: 'global.css',
      source: split.residual,
    });
    globalCss.push('/' + opts.getFileName(residualRef));
    delete bundle[cssFile];
    entry?.viteMetadata?.importedCss?.delete(cssFile);
  }
  return globalCss;
}
