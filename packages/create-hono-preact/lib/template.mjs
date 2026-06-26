import {
  cp,
  rename,
  readFile,
  writeFile,
  access,
  mkdir,
  readdir,
} from 'node:fs/promises';
import { join, dirname, basename } from 'node:path';

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

/**
 * Replace `{{name}}` and `{{name_underscore}}` in manifest and root README files
 * (the Cloudflare adapter writes its bundle to `dist/<name_with_underscores>/`,
 * so the underscored form is needed in deploy scripts and READMEs). Source files
 * keep the literal `{{name}}` placeholder as a discoverable edit-me marker.
 *
 * @param {string} target absolute path to the scaffolded dir
 * @param {string} name new project name
 */
export async function substituteName(target, name) {
  const underscored = name.replaceAll('-', '_');
  for (const file of ['package.json', 'wrangler.jsonc', 'README.md']) {
    const path = join(target, file);
    try {
      await access(path);
    } catch {
      continue;
    }
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
