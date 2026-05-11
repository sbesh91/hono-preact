import type { ComponentChildren, VNode } from 'preact';

export interface HeadProps {
  defaultTitle?: string;
  children?: ComponentChildren;
}

export function Head({ defaultTitle, children }: HeadProps): VNode {
  return (
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width,initial-scale=1.0" />
      <title>{defaultTitle ?? ''}</title>
      {children}
    </head>
  );
}
