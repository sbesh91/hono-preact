import ExamplePopover from "@/components/popover";
import type { FunctionComponent } from "preact";
import styles from "./test.module.scss";

const Test: FunctionComponent = () => {
  return (
    <section class="p-1">
      <a href="/" class={styles.test}>
        home
      </a>
      <ExamplePopover />
    </section>
  );
};

export default Test;
