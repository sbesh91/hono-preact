import type { LayoutProps } from '@hono-preact/iso';

export default function MoviesLayout({ children }: LayoutProps) {
  return (
    <section class="p-1">
      <header class="flex gap-2">
        <a href="/" class="bg-amber-200">home</a>
        <a href="/watched" class="bg-emerald-200">watched</a>
      </header>
      <div class="mt-2">{children}</div>
    </section>
  );
}
