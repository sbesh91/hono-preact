import { loader } from './foo.server.js';

export default function Foo() {
  const data = loader.useData();
  return <p>{data.secret}</p>;
}
