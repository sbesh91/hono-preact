import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import { useRoute } from 'preact-iso';
import { nav } from '../pages/docs/nav.js';

interface Props {
  children: ComponentChildren;
}

export function DocsLayout({ children }: Props) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { path } = useRoute();

  const allEntries = nav.flatMap((s) => s.entries);
  const idx = allEntries.findIndex((e) => e.route === path);
  const prev = idx > 0 ? allEntries[idx - 1] : null;
  const next =
    idx !== -1 && idx < allEntries.length - 1 ? allEntries[idx + 1] : null;
  const currentTitle = idx !== -1 ? allEntries[idx].title : '';

  const navSections = nav.map((section) => (
    <div class="flex flex-col gap-0.5">
      <div class="text-[0.7rem] font-bold uppercase tracking-[0.08em] text-slate-400 mb-1.5 px-1.5">
        {section.heading}
      </div>
      {section.entries.map((entry) => (
        <a
          href={entry.route}
          class={`block py-1.5 px-2 rounded text-sm no-underline ${
            entry.route === path
              ? 'bg-blue-100 text-blue-700 font-semibold'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200'
          }`}
        >
          {entry.title}
        </a>
      ))}
    </div>
  ));

  return (
    <div class="grid md:grid-cols-[220px_1fr] min-h-screen">
      {/* Desktop sidebar */}
      <aside class="hidden md:flex md:sticky md:top-0 md:h-screen md:overflow-y-auto md:bg-slate-50 md:border-r md:border-slate-200 md:p-4 md:flex-col md:gap-6">
        <a
          href="/docs"
          class="font-bold text-[0.95rem] text-slate-900 no-underline hover:text-blue-700"
        >
          hono-preact docs
        </a>
        {navSections}
      </aside>

      {/* Mobile top bar */}
      <div class="flex items-center gap-3 bg-slate-50 border-b border-slate-200 py-2.5 px-3 sticky top-0 z-30 md:hidden">
        <button
          class="flex items-center gap-1 bg-white border border-slate-200 rounded-md py-1 px-2.5 text-[0.8rem] font-semibold text-slate-600 cursor-pointer shadow-sm shrink-0 hover:bg-slate-100"
          onClick={() => setDrawerOpen(true)}
        >
          ☰ Menu
        </button>
        {currentTitle && (
          <span class="text-[0.85rem] font-semibold text-slate-900 whitespace-nowrap overflow-hidden text-ellipsis">
            {currentTitle}
          </span>
        )}
      </div>

      {/* Mobile drawer overlay */}
      <div
        class={`fixed inset-0 bg-black/35 z-40 ${drawerOpen ? 'block' : 'hidden'}`}
        onClick={() => setDrawerOpen(false)}
      />

      {/* Mobile drawer */}
      <div
        class={`fixed top-0 bottom-0 left-0 w-65 bg-slate-50 border-r border-slate-200 z-50 transition-transform duration-200 ease-in-out flex flex-col ${drawerOpen ? 'translate-x-0' : '-translate-x-full'}`}
      >
        <div class="flex justify-between items-center px-4 py-3 border-b border-slate-200 font-bold text-[0.9rem] text-slate-900">
          Docs
          <button
            class="bg-transparent border-none text-[1.1rem] text-slate-500 cursor-pointer leading-none p-1 hover:text-slate-900"
            onClick={() => setDrawerOpen(false)}
          >
            ✕
          </button>
        </div>
        <div class="p-3 overflow-y-auto flex-1 flex flex-col gap-5">
          {navSections}
        </div>
      </div>

      {/* Main content */}
      <main class="max-w-[65ch] py-8 px-6">
        <article class="mdx-content">{children}</article>
        <nav class="flex justify-between mt-12 pt-6 border-t border-slate-200 text-sm">
          <span>
            {prev && (
              <a
                href={prev.route}
                class="text-blue-600 no-underline hover:underline"
              >
                ← {prev.title}
              </a>
            )}
          </span>
          <span>
            {next && (
              <a
                href={next.route}
                class="text-blue-600 no-underline hover:underline"
              >
                {next.title} →
              </a>
            )}
          </span>
        </nav>
      </main>
    </div>
  );
}
