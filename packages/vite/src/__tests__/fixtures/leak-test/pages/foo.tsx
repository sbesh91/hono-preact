import { serverLoaders } from './foo.server.js';

export default function Foo() {
  const data = serverLoaders.default.useData();
  return <p>{data.secret}</p>;
}
