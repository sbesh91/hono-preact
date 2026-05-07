import { useLink } from 'hoofd/preact';
import { definePage } from '@hono-preact/iso';
import test from './test.css?url';
import styles from './test.module.scss';
import inline from './test.module.scss?inline';

function TestContent() {
  useLink({ rel: 'stylesheet', href: test });
  return (
    <section class="p-1">
      <style dangerouslySetInnerHTML={{ __html: inline }} />
      <a href="/" class={`test ${styles.test}`}>
        home
      </a>
    </section>
  );
}
TestContent.displayName = 'Test';

const Test = definePage(TestContent);

export default Test;
