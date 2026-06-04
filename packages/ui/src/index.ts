// Public barrel for @hono-preact/ui. Primitives and components are exported
// here as they land in subsequent tasks.
export { mergeRefs } from './merge-refs.js';
export { useRender, type RenderProp } from './use-render.js';
export { useControllableState } from './use-controllable-state.js';
export {
  usePosition,
  placementFor,
  sideAlignFromPlacement,
  type UsePositionOptions,
  type PositionState,
  type Side,
  type Align,
} from './use-position.js';
export { useDismiss, type UseDismissOptions } from './use-dismiss.js';
export { type DismissReason } from './dismiss-stack.js';
export {
  useFocusReturn,
  type UseFocusReturnOptions,
} from './use-focus-return.js';
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
export {
  Popover,
  PopoverRoot,
  PopoverTrigger,
  PopoverAnchor,
  PopoverPositioner,
  PopoverPopup,
  PopoverArrow,
  PopoverTitle,
  PopoverDescription,
  PopoverClose,
  type PopoverRootProps,
  type PopoverTriggerProps,
  type PopoverAnchorProps,
  type PopoverPositionerProps,
  type PopoverPopupProps,
  type PopoverArrowProps,
  type PopoverTitleProps,
  type PopoverDescriptionProps,
  type PopoverCloseProps,
} from './popover/index.js';
