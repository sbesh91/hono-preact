import ExamplePopover from "@/components/popover";
import type { FunctionComponent } from "preact";

const Test: FunctionComponent = () => {
  return (
    <section class="p-1">
      <a href="/">home</a>
      <ExamplePopover />
    </section>
  );
};

export default Test;
