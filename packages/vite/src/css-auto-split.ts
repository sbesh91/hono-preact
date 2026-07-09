// Build-time CSS auto-split (issue #249 Layer 3): tree-shake the app's global
// stylesheet into per-chunk sheets by class-name usage evidence. See
// docs/superpowers/specs/2026-07-09-css-auto-split-design.md.
//
// Safety invariant: a rule that cannot be PROVEN exclusive to one scopable
// chunk stays in the residual global sheet. Splitting is an optimization,
// never a correctness risk; nothing is ever dropped ("unused" CSS is not
// purged, it stays global).

import { transform } from 'lightningcss';
import type { Targets } from 'lightningcss';

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
        return rule;
      },
    },
  });
  return { owners, layerNames };
}
