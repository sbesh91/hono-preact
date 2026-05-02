import {
  BookOpen,
  Cloud,
  Database,
  FileText,
  FolderTree,
  Layers,
  Loader,
  RefreshCw,
  Rocket,
  Send,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  type LucideIcon,
  Zap,
} from 'lucide-preact';

export type NavEntry = { title: string; route: string; icon: LucideIcon };
export type NavSection = { heading: string; entries: NavEntry[] };

export const nav: NavSection[] = [
  {
    heading: 'Introduction',
    entries: [
      { title: 'Overview', route: '/docs', icon: BookOpen },
      { title: 'Quick Start', route: '/docs/quick-start', icon: Rocket },
    ],
  },
  {
    heading: 'Pages & Routing',
    entries: [
      { title: 'Adding Pages', route: '/docs/pages', icon: FileText },
    ],
  },
  {
    heading: 'Data',
    entries: [
      { title: 'Server Loaders', route: '/docs/loaders', icon: Database },
      { title: 'Loading States', route: '/docs/loading-states', icon: Loader },
      { title: 'Reloading Data', route: '/docs/reloading', icon: RefreshCw },
      { title: 'Prefetching', route: '/docs/prefetch', icon: Zap },
    ],
  },
  {
    heading: 'Mutations',
    entries: [
      { title: 'Server Actions', route: '/docs/actions', icon: Send },
      { title: 'Action Guards', route: '/docs/action-guards', icon: ShieldAlert },
      { title: 'Optimistic UI', route: '/docs/optimistic-ui', icon: Sparkles },
    ],
  },
  {
    heading: 'Access Control',
    entries: [
      { title: 'Route Guards', route: '/docs/guards', icon: ShieldCheck },
    ],
  },
  {
    heading: 'Infrastructure',
    entries: [
      { title: 'Vite Config', route: '/docs/vite-config', icon: Settings },
      { title: 'Project Structure', route: '/docs/structure', icon: FolderTree },
      { title: 'renderPage', route: '/docs/render-page', icon: Layers },
      { title: 'Build & Deploy', route: '/docs/deployment', icon: Cloud },
    ],
  },
];
