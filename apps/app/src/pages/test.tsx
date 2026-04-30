import { Page } from '@hono-preact/iso';
import { useLink } from 'hoofd/preact';
import { type FunctionComponent } from 'preact';
import type { RouteHook } from 'preact-iso';
import test from './test.css?url';
import styles from './test.module.scss';
import inline from './test.module.scss?inline';

const Test: FunctionComponent = () => {
  useLink({ rel: 'stylesheet', href: test });
  return (
    <section class="p-1">
      <style dangerouslySetInnerHTML={{ __html: inline }} />
      <a href="/" class={`test ${styles.test}`}>
        home
      </a>
    </section>
  );
};
Test.displayName = 'Test';

export default function TestPage(location: RouteHook) {
  return (
    <Page location={location}>
      <Test />
    </Page>
  );
}
