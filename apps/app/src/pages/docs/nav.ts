export type NavEntry = { title: string; route: string };
export type NavSection = { heading: string; entries: NavEntry[] };

export const nav: NavSection[] = [
  {
    heading: 'Getting Started',
    entries: [
      { title: 'Overview', route: '/docs' },
      { title: 'Project Structure', route: '/docs/structure' },
      { title: 'Vite Configuration', route: '/docs/vite-config' },
    ],
  },
  {
    heading: 'Guides',
    entries: [
      { title: 'Rendering Pages', route: '/docs/render-page' },
      { title: 'Adding Pages', route: '/docs/pages' },
      { title: 'Server Loaders', route: '/docs/loaders' },
      { title: 'Loading States', route: '/docs/loading-states' },
      { title: 'Reloading Data', route: '/docs/reloading' },
      { title: 'Server Actions', route: '/docs/actions' },
      { title: 'Route Guards', route: '/docs/guards' },
      { title: 'Build & Deploy', route: '/docs/deployment' },
    ],
  },
];
