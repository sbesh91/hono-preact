import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export type WorkspaceAlias = { find: string; replacement: string };

type ExportCondition = string | { import?: string; [key: string]: unknown };

type PackageJson = {
  name: string;
  exports: Record<string, ExportCondition>;
};

/**
 * Derive Vite resolve aliases from each workspace package's `exports` map so
 * the docs site's dev server and build resolve framework subpaths to workspace
 * `src/` instead of the published `dist/`. workerd refuses a `dist/` module for
 * a subpath that has no alias, which kills dev; generating the list from
 * `exports` keeps it complete on its own as subpaths are added, rather than
 * relying on someone remembering to hand-add each new one.
 *
 * For each package: read its `package.json`, walk `exports`, map the resolved
 * `import` target from `/dist/*.js` to `/src/*.ts`, and build a `{ find,
 * replacement }` pair. `find` is the bare package name for the `.` entry and
 * `name + subpath` for every other entry. The combined list is sorted
 * longest-`find` first so subpath aliases win over the bare-package alias under
 * Vite's first-match (prefix) string matching.
 */
export function workspaceAliases(packageDirs: string[]): WorkspaceAlias[] {
  const aliases: WorkspaceAlias[] = [];
  for (const dir of packageDirs) {
    const pkg: PackageJson = JSON.parse(
      readFileSync(resolve(dir, 'package.json'), 'utf8')
    );
    for (const [subpath, cond] of Object.entries(pkg.exports)) {
      const target = typeof cond === 'string' ? cond : cond.import;
      if (!target) continue;
      const src = target.replace('/dist/', '/src/').replace(/\.js$/, '.ts');
      const find = subpath === '.' ? pkg.name : pkg.name + subpath.slice(1);
      aliases.push({ find, replacement: resolve(dir, src) });
    }
  }
  return aliases.sort((a, b) => b.find.length - a.find.length);
}
