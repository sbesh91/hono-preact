import type { FunctionComponent } from 'preact';
import type { RenderOutcome } from './outcomes.js';

export { isRender } from './outcomes.js';

export function render(Component: FunctionComponent): RenderOutcome {
  return { __outcome: 'render', Component };
}
