import {
  BookOpen,
  Cable,
  Cloud,
  Database,
  FileText,
  FolderTree,
  Layers,
  LayoutGrid,
  Loader,
  Map as MapIcon,
  MousePointerClick,
  Plug,
  Radio,
  RefreshCw,
  Rocket,
  Send,
  Settings,
  Lock,
  Shield,
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
      { title: 'The Route Table', route: '/docs/routes', icon: MapIcon },
      { title: 'Layouts & Nesting', route: '/docs/layouts', icon: LayoutGrid },
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
      { title: 'Streaming', route: '/docs/streaming', icon: Radio },
    ],
  },
  {
    heading: 'Mutations',
    entries: [
      { title: 'Server Actions', route: '/docs/actions', icon: Send },
      { title: 'Optimistic UI', route: '/docs/optimistic-ui', icon: Sparkles },
    ],
  },
  {
    heading: 'Access Control',
    entries: [
      { title: 'Middleware', route: '/docs/middleware', icon: Shield },
      { title: 'CSRF Protection', route: '/docs/csrf', icon: Lock },
    ],
  },
  {
    heading: 'Infrastructure',
    entries: [
      { title: 'Vite Config', route: '/docs/vite-config', icon: Settings },
      {
        title: 'Project Structure',
        route: '/docs/structure',
        icon: FolderTree,
      },
      {
        title: 'Composing Hono Middleware',
        route: '/docs/hono-middleware',
        icon: Plug,
      },
      { title: 'WebSockets', route: '/docs/websockets', icon: Cable },
      { title: 'renderPage', route: '/docs/render-page', icon: Layers },
      {
        title: 'Link Prefetch',
        route: '/docs/link-prefetch',
        icon: MousePointerClick,
      },
      { title: 'Build & Deploy', route: '/docs/deployment', icon: Cloud },
    ],
  },
];
