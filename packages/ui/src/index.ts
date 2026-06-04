// Public barrel for @hono-preact/ui. Primitives and components are exported
// here as they land in subsequent tasks.
export { mergeRefs } from './merge-refs.js';
export { useRender, type RenderProp } from './use-render.js';
export { useControllableState } from './use-controllable-state.js';
export {
  Dialog,
  DialogRoot,
  DialogTrigger,
  DialogPopup,
  DialogTitle,
  DialogDescription,
  DialogClose,
  type DialogRootProps,
  type DialogTriggerProps,
  type DialogPopupProps,
  type DialogTitleProps,
  type DialogDescriptionProps,
  type DialogCloseProps,
} from './dialog/index.js';
