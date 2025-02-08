import type { FC } from "hono/jsx";
import { messages } from "../iso.js";

export const Home: FC = () => {
  return (
    <section>
      <a href="/test">test</a>
      <h1>Hello Hono!</h1>
      <ul>
        {messages.map((message) => {
          return <li>{message}!!</li>;
        })}
      </ul>

      <button onClick={console.log}>hello World</button>
    </section>
  );
};

export default Home;
