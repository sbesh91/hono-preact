export let env: { current: "browser" | "server" } = {
  current: "browser",
};
export function isBrowser() {
  return env.current === "browser";
}
