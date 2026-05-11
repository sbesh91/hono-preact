import { useEffect } from 'preact/hooks';
import { __enableViewTransitions } from './internal/route-change.js';

export function ViewTransitions(): null {
  useEffect(() => __enableViewTransitions(), []);
  return null;
}
