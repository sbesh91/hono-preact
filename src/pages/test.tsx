import { getLoaderData } from '@/iso/loader';
import { Fragment, type FunctionComponent } from 'preact';
import test from './test.css?url';
import styles from './test.module.scss';
import inline from './test.module.scss?inline';

const Test: FunctionComponent = () => {
  return (
    <section class="p-1">
      <a href="/" class={`test ${styles.test}`}>
        home
      </a>
    </section>
  );
};
Test.displayName = 'Test';
Test.defaultProps = { route: '/test' };

function Head() {
  return (
    <Fragment>
      <link rel="stylesheet" href={test} />
      <style dangerouslySetInnerHTML={{ __html: inline }} />
    </Fragment>
  );
}

Head.displayName = 'Head';

export default getLoaderData(Test, {
  Head,
});
