export type NavEntry = { title: string; route: string };
export type NavSection = { heading: string; entries: NavEntry[] };

export const nav: NavSection[] = [
  {
    heading: 'Introduction',
    entries: [
      { title: 'Overview', route: '/docs' },
      { title: 'Quick Start', route: '/docs/quick-start' },
    ],
  },
  {
    heading: 'Pages & Routing',
    entries: [
      { title: 'Adding Pages', route: '/docs/pages' },
    ],
  },
  {
    heading: 'Data',
    entries: [
      { title: 'Server Loaders', route: '/docs/loaders' },
      { title: 'Loading States', route: '/docs/loading-states' },
      { title: 'Reloading Data', route: '/docs/reloading' },
    ],
  },
  {
    heading: 'Mutations',
    entries: [
      { title: 'Server Actions', route: '/docs/actions' },
      { title: 'Action Guards', route: '/docs/action-guards' },
      { title: 'Optimistic UI', route: '/docs/optimistic-ui' },
    ],
  },
  {
    heading: 'Access Control',
    entries: [
      { title: 'Route Guards', route: '/docs/guards' },
    ],
  },
  {
    heading: 'Infrastructure',
    entries: [
      { title: 'Vite Config', route: '/docs/vite-config' },
      { title: 'Project Structure', route: '/docs/structure' },
      { title: 'renderPage', route: '/docs/render-page' },
      { title: 'Build & Deploy', route: '/docs/deployment' },
    ],
  },
];
