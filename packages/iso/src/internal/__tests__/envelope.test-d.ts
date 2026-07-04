import type { ComponentProps } from 'preact';
import { Envelope } from '../envelope.js';

// Regression (#222 item 12): `Envelope`'s `as` is narrowed to intrinsic
// elements only. A custom-component wrapper cannot forward the ref the
// de-orphan layout effect needs to identify its own DOM node, so it would
// silently no-op the effect; a component is therefore no longer an accepted
// `as`. (Page's `Wrapper` prop is the public custom-wrapper knob.)
type EnvAs = ComponentProps<typeof Envelope>['as'];

// An intrinsic tag is accepted.
const intrinsic: EnvAs = 'section';
void intrinsic;

// A custom component wrapper is rejected. If `as` is ever re-widened to accept
// a `ComponentType`, this assignment succeeds and the unused directive fails
// the type check, flagging the regression.
// @ts-expect-error - `as` no longer accepts a component wrapper.
const component: EnvAs = (_props: { id: string }) => null;
void component;
