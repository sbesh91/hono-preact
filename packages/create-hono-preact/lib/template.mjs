import { cp, rename, readFile, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';

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
 * Copy the agent-guidance files into a target directory. Per-file: created if
 * absent, overwritten when `force`, otherwise skipped.
 * @param {string} agentsDir
 * @param {string} targetDir
 * @param {{ force: boolean }} options
 * @returns {Promise<Array<{ file: string, action: 'created' | 'overwritten' | 'skipped' }>>}
 */
export async function copyAgentsFiles(agentsDir, targetDir, { force }) {
  const results = [];
  for (const file of ['AGENTS.md', 'CLAUDE.md']) {
    const dest = join(targetDir, file);
    const exists = await fileExists(dest);
    if (exists && !force) {
      results.push({ file, action: 'skipped' });
      continue;
    }
    await cp(join(agentsDir, file), dest);
    results.push({ file, action: exists ? 'overwritten' : 'created' });
  }
  return results;
}
