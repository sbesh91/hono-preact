import ExamplePopover from "@/components/popover";
import type { FunctionComponent } from "preact";

export const Test: FunctionComponent = () => {
  return (
    <section class="p-1">
      <a href="/" class="bg-amber-200">
        home
      </a>
      <ExamplePopover />
    </section>
  );
};

export default Test;
