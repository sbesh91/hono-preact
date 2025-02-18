import ExamplePopover from "@/components/popover";
import { importStylesheet, inlineStylesheet } from "@/iso/import-stylesheet";
import type { FunctionComponent } from "preact";
import test from "./test.css?url";
import styles from "./test.module.scss";

importStylesheet(test);
inlineStylesheet(import("./test.module.scss?inline"));

const Test: FunctionComponent = () => {
  return (
    <section class="p-1">
      <a href="/" class={`test ${styles.test}`}>
        home
      </a>
      <ExamplePopover />
    </section>
  );
};

export default Test;
