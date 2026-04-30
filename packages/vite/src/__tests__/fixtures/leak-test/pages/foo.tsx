import { useLoaderData } from '@hono-preact/iso';
import { loader } from './foo.server.js';

export default function Foo() {
  const data = useLoaderData(loader);
  return <p>{data.secret}</p>;
}
