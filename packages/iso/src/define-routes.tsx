import type { ComponentChildren, ComponentType, JSX } from 'preact';

export type LayoutProps = { children: ComponentChildren };

export type ViewProps<P = Record<string, string>> = {
  params: P;
};

type LazyImport<T> = () => Promise<{ default: T }>;
type LazyServerImport = () => Promise<unknown>;

export type RouteDef = {
  path: string;
  view?: LazyImport<ComponentType<ViewProps>>;
  layout?: LazyImport<ComponentType<LayoutProps>>;
  server?: LazyServerImport;
  children?: RouteDef[];
  fallback?: JSX.Element;
  errorFallback?:
    | JSX.Element
    | ((error: Error, reset: () => void) => JSX.Element);
};

export type FlatRoute = {
  path: string;
  component: ComponentType;
  fallback?: JSX.Element;
  errorFallback?: RouteDef['errorFallback'];
};

export type RoutesManifest = {
  tree: ReadonlyArray<RouteDef>;
  flat: ReadonlyArray<FlatRoute>;
  serverImports: ReadonlyArray<LazyServerImport>;
};

function validate(routes: ReadonlyArray<RouteDef>, parentPath = ''): void {
  for (const r of routes) {
    const here = parentPath + (r.path.startsWith('/') ? r.path : '/' + r.path);
    const hasView = !!r.view;
    const hasLayout = !!r.layout;
    const hasChildren = !!(r.children && r.children.length > 0);
    const hasServer = !!r.server;

    if (hasView && hasLayout) {
      throw new Error(`Route ${here}: cannot declare both \`view\` and \`layout\`.`);
    }
    if (hasView && hasChildren) {
      throw new Error(`Route ${here}: \`view\` route cannot have \`children\`.`);
    }
    if (hasLayout && !hasChildren) {
      throw new Error(`Route ${here}: \`layout\` requires \`children\`.`);
    }
    if (hasLayout && hasServer) {
      throw new Error(`Route ${here}: \`layout\` cannot declare \`server\` (one loader per leaf).`);
    }
    if (!hasView && !hasLayout && !hasChildren) {
      throw new Error(`Route ${here}: must declare \`view\`, \`layout\`+\`children\`, or \`children\`.`);
    }

    if (parentPath !== '' && r.path.startsWith('/')) {
      throw new Error(`Route ${here}: child path must not start with \`/\`.`);
    }

    if (hasChildren) validate(r.children!, here === '/' ? '' : here);
  }
}

function collectServerImports(routes: ReadonlyArray<RouteDef>): LazyServerImport[] {
  const out: LazyServerImport[] = [];
  const walk = (rs: ReadonlyArray<RouteDef>) => {
    for (const r of rs) {
      if (r.server) out.push(r.server);
      if (r.children) walk(r.children);
    }
  };
  walk(routes);
  return out;
}

export function defineRoutes(tree: RouteDef[]): RoutesManifest {
  validate(tree);
  return {
    tree,
    flat: [], // populated in Task 3
    serverImports: collectServerImports(tree),
  };
}
