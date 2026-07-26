import { serverLoaders } from './foo.server.js';

export default function Foo() {
  const s = serverLoaders.default.useData();
  // Narrow on `status`, the ADT's discriminant. `'data' in s` does not narrow:
  // the cold `loading` arm declares `data?: never`, so the key is present on
  // every arm.
  return <p>{s.status === 'loading' ? '' : s.data.secret}</p>;
}
