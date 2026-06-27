import { serverLoaders } from './foo.server.js';

export default function Foo() {
  const s = serverLoaders.default.useData();
  return <p>{'data' in s ? s.data.secret : ''}</p>;
}
