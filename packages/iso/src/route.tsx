import type { ComponentType, JSX } from 'preact';
import type { RouteHook } from 'preact-iso';
import { Page, type PageProps } from './page.js';

export type PageConfig<T> = Omit<PageProps<T>, 'location' | 'children'>;

export function wrapWithPage<T>(
  Component: ComponentType,
  config: PageConfig<T>
): (location: RouteHook) => JSX.Element {
  return function PageRouteHandler(location: RouteHook) {
    return (
      <Page {...config} location={location}>
        <Component />
      </Page>
    );
  };
}
