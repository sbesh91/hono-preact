declare module '*.mdx' {
  import type { ComponentType } from 'preact';
  const MDXContent: ComponentType;
  export default MDXContent;
}
