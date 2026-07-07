import { useEffect } from 'preact/hooks';
// Imported only from this lazily-imported route view, so the worker SSR entry
// scan would miss it without the routes-manifest scan entry. That late
// discovery is what triggered the mid-render reload and the __H crash.
import { z } from 'zod';

const schema = z.string();

export default function LateView() {
  useEffect(() => {
    // Reference the dep so it is a real, non-elided import.
    void schema;
  }, []);
  return <h1>late view ok</h1>;
}
