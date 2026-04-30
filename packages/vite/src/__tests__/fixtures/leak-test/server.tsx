// Minimal server entry so a full toolchain (if invoked) can resolve it.
// The build-leak test only exercises the client transform, so this file
// is intentionally trivial.
import { Base } from './iso.js';
export { Base };
export default Base;
