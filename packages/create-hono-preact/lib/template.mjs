import {
  cp,
  rename,
  readFile,
  writeFile,
  access,
  mkdir,
  readdir,
} from 'node:fs/promises';
import { join, dirname, basename, extname } from 'node:path';

/**
 * Recursively copy a template directory into the target.
 *
 * @param {string} source absolute path to the template tree
 * @param {string} target absolute path to the destination dir
 */
export async function copyTemplate(source, target) {
  await cp(source, target, { recursive: true });
}

/**
 * Recursively copy a template tree into the target, skipping files whose
 * basename appears in `exclude`. Existing files are overwritten (overlay
 * semantics); directories are always traversed.
 *
 * @param {string} source absolute path to the template tree
 * @param {string} target absolute path to the destination dir
 * @param {string[]} [exclude] basenames to skip (e.g. ['package.json'])
 */
export async function copyTreeExcept(source, target, exclude = []) {
  const skip = new Set(exclude);
  await cp(source, target, {
    recursive: true,
    filter: (src) => !skip.has(basename(src)),
  });
}

/**
 * Rename underscore-prefixed dotfiles emitted by the template
 * (e.g. `_gitignore` -> `.gitignore`). npm and pnpm strip dotfiles from
 * published tarballs, so the template ships with the underscore name.
 *
 * @param {string} target absolute path to the scaffolded dir
 */
export async function renameDotfiles(target) {
  const map = [['_gitignore', '.gitignore']];
  for (const [from, to] of map) {
    const src = join(target, from);
    try {
      await access(src);
    } catch {
      continue;
    }
    await rename(src, join(target, to));
  }
}

// File types the name substitution rewrites. Everything the templates ship
// is text in one of these; anything else (images, archives) must never be
// string-replaced.
const SUBSTITUTABLE_EXTENSIONS = new Set([
  '.json',
  '.jsonc',
  '.md',
  '.ts',
  '.tsx',
  '.html',
  '.yaml',
]);

// Directories the substitution walk never descends into. Neither exists at
// scaffold time today; this is a guard against a future reordering (an
// install or git init before substitution) turning the walk expensive.
const SUBSTITUTION_SKIP_DIRS = new Set(['node_modules', '.git']);

/**
 * Collect every substitutable file under `dir`, recursively.
 *
 * @param {string} dir absolute directory to walk
 * @returns {Promise<string[]>} absolute file paths
 */
async function collectSubstitutableFiles(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SUBSTITUTION_SKIP_DIRS.has(entry.name)) {
        out.push(...(await collectSubstitutableFiles(path)));
      }
    } else if (SUBSTITUTABLE_EXTENSIONS.has(extname(entry.name))) {
      out.push(path);
    }
  }
  return out;
}

/**
 * Replace `{{name}}` and `{{name_underscore}}` across the scaffolded tree:
 * manifests, READMEs, and source files alike (the `<Head>` default title
 * and the home-page heading carry `{{name}}`, and must render as the real
 * project name on the first `pnpm dev`). The Cloudflare adapter writes its
 * bundle to `dist/<name_with_underscores>/`, so the underscored form is
 * needed in deploy scripts and READMEs.
 *
 * The name is validated as a strict slug before any scaffolding runs (see
 * resolve.mjs), so this textual substitution cannot inject syntax into any
 * of these sinks; package.json's `name` field is additionally set
 * structurally in scaffold.mjs.
 *
 * @param {string} target absolute path to the scaffolded dir
 * @param {string} name new project name
 */
export async function substituteName(target, name) {
  const underscored = name.replaceAll('-', '_');
  for (const path of await collectSubstitutableFiles(target)) {
    const original = await readFile(path, 'utf8');
    const updated = original
      .replaceAll('{{name_underscore}}', underscored)
      .replaceAll('{{name}}', name);
    if (updated !== original) {
      await writeFile(path, updated);
    }
  }
}

/** True if a path exists. */
export async function fileExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Copy the agent-guidance payload into a target project. Root files (AGENTS.md,
 * CLAUDE.md) land at the project root; recipes and the bundled docs corpus land
 * under the project's `agents/` directory. Per-file: created if absent,
 * overwritten when `force`, otherwise skipped.
 *
 * @param {string} agentsDir absolute path to templates/agents
 * @param {string} targetDir absolute path to the destination project
 * @param {{ force: boolean }} options
 * @returns {Promise<Array<{ file: string, action: 'created' | 'overwritten' | 'skipped' }>>}
 */
export async function copyAgentGuidance(agentsDir, targetDir, { force }) {
  /** @type {Array<{ from: string, to: string }>} */
  const plan = [
    { from: 'AGENTS.md', to: 'AGENTS.md' },
    { from: 'CLAUDE.md', to: 'CLAUDE.md' },
    { from: 'llms-full.txt', to: join('agents', 'llms-full.txt') },
  ];
  const skills = (await readdir(join(agentsDir, 'skills'))).filter((f) =>
    f.endsWith('.md')
  );
  for (const name of skills) {
    plan.push({
      from: join('skills', name),
      to: join('agents', 'skills', name),
    });
  }

  const results = [];
  for (const { from, to } of plan) {
    const dest = join(targetDir, to);
    const exists = await fileExists(dest);
    if (exists && !force) {
      results.push({ file: to, action: 'skipped' });
      continue;
    }
    await mkdir(dirname(dest), { recursive: true });
    await cp(join(agentsDir, from), dest);
    results.push({ file: to, action: exists ? 'overwritten' : 'created' });
  }
  return results;
}

/**
 * True for a non-null, non-array object.
 *
 * @param {unknown} v
 * @returns {v is Record<string, unknown>}
 */
function isPlainObject(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Deep-merge two plain objects. Nested objects merge recursively; arrays and
 * scalars from `b` replace those in `a`. Neither input is mutated.
 *
 * @param {Record<string, unknown>} a
 * @param {Record<string, unknown>} b
 * @returns {Record<string, unknown>}
 */
export function deepMerge(a, b) {
  /** @type {Record<string, unknown>} */
  const out = { ...a };
  for (const [key, bv] of Object.entries(b)) {
    const av = out[key];
    out[key] = isPlainObject(av) && isPlainObject(bv) ? deepMerge(av, bv) : bv;
  }
  return out;
}

/**
 * Read and deep-merge an ordered list of package.json fragment files into one
 * object. Earlier paths are the base; later paths overlay.
 *
 * @param {string[]} fragmentPaths absolute paths to package.json fragments
 * @returns {Promise<Record<string, unknown>>}
 */
export async function composePackageJson(fragmentPaths) {
  /** @type {Record<string, unknown>} */
  let merged = {};
  for (const path of fragmentPaths) {
    const fragment = JSON.parse(await readFile(path, 'utf8'));
    merged = deepMerge(merged, fragment);
  }
  return merged;
}
