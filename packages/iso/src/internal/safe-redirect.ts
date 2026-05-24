export function isSameOrigin(target: string): boolean {
  if (typeof window === 'undefined') return true;
  try {
    // Relative URLs resolve against the current origin and are always same-origin.
    const resolved = new URL(target, window.location.href);
    return resolved.origin === window.location.origin;
  } catch {
    return false;
  }
}

/**
 * Navigate to `target` only when it resolves same-origin against the current
 * window. Cross-origin targets log a console error and are not followed.
 * Returns true when the navigation was issued.
 */
export function assignSafeRedirect(target: string): boolean {
  if (typeof window === 'undefined') return false;
  if (!isSameOrigin(target)) {
    console.error(
      `[hono-preact] refusing to navigate to cross-origin redirect target: ${target}`
    );
    return false;
  }
  window.location.assign(target);
  return true;
}
