// packages/ui/src/combobox/autocomplete.ts

export interface InlineCompletion {
  text: string; // the full completed text to display
  selStart: number; // start of the auto-added (selected) suffix
  selEnd: number; // end of the suffix (== text.length)
}

// Compute the inline completion for `typed` against the first option's
// `firstLabel`. Returns the completed text with the appended suffix selected,
// or null when there is nothing to complete (no label, empty input, no
// case-insensitive prefix match, or the label is fully typed already).
export function computeInlineCompletion(
  typed: string,
  firstLabel: string | null
): InlineCompletion | null {
  if (!typed || !firstLabel) return null;
  if (firstLabel.length <= typed.length) return null;
  if (firstLabel.slice(0, typed.length).toLowerCase() !== typed.toLowerCase()) {
    return null;
  }
  return { text: firstLabel, selStart: typed.length, selEnd: firstLabel.length };
}

// True when `next` appended characters to `prev` (a forward insertion). Used to
// gate inline completion so deletions never re-complete.
export function isForwardEdit(prev: string, next: string): boolean {
  return next.length > prev.length;
}

// A convenience substring matcher for the common in-memory filter case.
// Consumers compose it: options.filter((o) => matchSubstring(o.label, query)).
export function matchSubstring(label: string, query: string): boolean {
  return label.toLowerCase().includes(query.trim().toLowerCase());
}
