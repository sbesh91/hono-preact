import {
  Blocks,
  BookOpen,
  Boxes,
  Compass,
  Database,
  Map as MapIcon,
  PanelsTopLeft,
  Send,
  Server,
  Shield,
  Wand2,
  type LucideIcon,
} from 'lucide-preact';

export type NavEntry = { title: string; route: string };
export type NavSection = {
  heading: string;
  icon: LucideIcon;
  entries: NavEntry[];
};
export type NavArea = {
  id: 'guide' | 'components';
  label: string;
  icon: LucideIcon;
  basePath: string;
  sections: NavSection[];
};

export const nav: NavArea[] = [
  {
    id: 'guide',
    label: 'Guide',
    icon: BookOpen,
    basePath: '/docs',
    sections: [
      {
        heading: 'Introduction',
        icon: BookOpen,
        entries: [
          { title: 'Overview', route: '/docs' },
          { title: 'Quick Start', route: '/docs/quick-start' },
        ],
      },
      {
        heading: 'Pages & Routing',
        icon: MapIcon,
        entries: [
          { title: 'The Route Table', route: '/docs/routes' },
          { title: 'Layouts & Nesting', route: '/docs/layouts' },
          { title: 'Adding Pages', route: '/docs/pages' },
          { title: 'Active Links', route: '/docs/active-links' },
        ],
      },
      {
        heading: 'Data',
        icon: Database,
        entries: [
          { title: 'Server Loaders', route: '/docs/loaders' },
          { title: 'Loading States', route: '/docs/loading-states' },
          { title: 'Reloading Data', route: '/docs/reloading' },
          { title: 'Prefetching', route: '/docs/prefetch' },
          { title: 'Streaming', route: '/docs/streaming' },
        ],
      },
      {
        heading: 'Mutations',
        icon: Send,
        entries: [
          { title: 'Server Actions', route: '/docs/actions' },
          { title: 'Optimistic UI', route: '/docs/optimistic-ui' },
        ],
      },
      {
        heading: 'View Transitions',
        icon: Wand2,
        entries: [
          { title: 'View Transitions', route: '/docs/view-transitions' },
        ],
      },
      {
        heading: 'Access Control',
        icon: Shield,
        entries: [
          { title: 'Middleware', route: '/docs/middleware' },
          { title: 'CSRF Protection', route: '/docs/csrf' },
        ],
      },
      {
        heading: 'Infrastructure',
        icon: Server,
        entries: [
          { title: 'Vite Config', route: '/docs/vite-config' },
          { title: 'Project Structure', route: '/docs/structure' },
          {
            title: 'Composing Hono Middleware',
            route: '/docs/hono-middleware',
          },
          { title: 'WebSockets', route: '/docs/websockets' },
          { title: 'renderPage', route: '/docs/render-page' },
          { title: 'Link Prefetch', route: '/docs/link-prefetch' },
          { title: 'Build & Deploy', route: '/docs/deployment' },
        ],
      },
    ],
  },
  {
    id: 'components',
    label: 'Components',
    icon: Boxes,
    basePath: '/docs/components',
    sections: [
      {
        heading: 'Getting started',
        icon: Compass,
        entries: [{ title: 'Overview', route: '/docs/components' }],
      },
      {
        heading: 'Overlays',
        icon: PanelsTopLeft,
        entries: [{ title: 'Dialog', route: '/docs/components/dialog' }],
      },
      {
        heading: 'Foundations',
        icon: Blocks,
        entries: [
          { title: 'useRender', route: '/docs/components/use-render' },
          {
            title: 'useControllableState',
            route: '/docs/components/use-controllable-state',
          },
          { title: 'mergeRefs', route: '/docs/components/merge-refs' },
        ],
      },
    ],
  },
];
