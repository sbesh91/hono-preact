import ExamplePopover from "@/components/popover";
import { importStylesheet } from "@/iso/import-stylesheet";
import type { FunctionComponent } from "preact";
import test from "./test.css?url";
// import raw from "./test.css?raw";

importStylesheet(test);
// inlineStylesheet(raw);

const Test: FunctionComponent = () => {
  return (
    <section class="p-1">
      <a href="/" class="test">
        home
      </a>
      <ExamplePopover />
    </section>
  );
};

export default Test;
