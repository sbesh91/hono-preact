export interface GenerateServerEntrySourceOptions {
  layoutAbsPath: string;
  routesAbsPath: string;
  apiAbsPath: string | undefined;
}

export function generateServerEntrySource(
  opts: GenerateServerEntrySourceOptions
): string {
  const { layoutAbsPath, routesAbsPath, apiAbsPath } = opts;

  const apiImport = apiAbsPath
    ? `import userApp from '${apiAbsPath}';\n`
    : '';
  const apiMount = apiAbsPath ? `  .route('/', userApp)\n` : '';

  return (
    `import { Hono } from 'hono';\n` +
    `import { env } from '@hono-preact/iso';\n` +
    `import {\n` +
    `  actionsHandler,\n` +
    `  loadersHandler,\n` +
    `  location,\n` +
    `  renderPage,\n` +
    `  routeServerModules,\n` +
    `} from '@hono-preact/server';\n` +
    `import Layout from '${layoutAbsPath}';\n` +
    `import routes from '${routesAbsPath}';\n` +
    apiImport +
    `\n` +
    `env.current = 'server';\n` +
    `const serverModules = routeServerModules(routes);\n` +
    `\n` +
    `export const app = new Hono()\n` +
    `  .post('/__loaders', loadersHandler(serverModules))\n` +
    `  .post('/__actions', actionsHandler(serverModules))\n` +
    apiMount +
    `  .use(location)\n` +
    `  .get('*', (c) => renderPage(c, <Layout context={c} />));\n` +
    `\n` +
    `export default app;\n`
  );
}
