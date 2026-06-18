// `import html from './FooDemo.tsx?highlighted'` yields the file's Shiki-
// highlighted HTML as a string (produced by vite-plugin-highlight at build).
declare module '*?highlighted' {
  const html: string;
  export default html;
}
