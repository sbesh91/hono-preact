import { existsSync, readdirSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';

/**
 * @typedef {Object} ResolvedOptions
 * @property {string} targetDir
 * @property {'cloudflare' | 'node'} adapter
 * @property {boolean} ui
 * @property {boolean} install
 * @property {boolean} git
 * @property {boolean} skipHints
 */

/**
 * Validate a project directory name for the interactive prompt: reject an empty
 * or whitespace-only name, and reject a target that already exists and is not
 * empty (an empty existing directory is allowed). Returns an error string to
 * show, or undefined when the name is acceptable.
 *
 * @param {string} value the raw prompt input
 * @param {string} cwd directory the target is resolved against
 * @returns {string | undefined}
 */
export function validateDirName(value, cwd) {
  const name = value.trim();
  if (name.length === 0) return 'A project directory is required.';
  const dest = resolvePath(cwd, name);
  if (existsSync(dest) && readdirSync(dest).length > 0) {
    return `Directory '${name}' already exists and is not empty.`;
  }
  return undefined;
}

/**
 * Resolve parsed flags into a complete option set. In interactive mode, prompt
 * for any field a flag did not supply. In non-interactive mode, fill defaults
 * (adapter cloudflare, ui off, install on, git on); a missing target directory
 * is an error.
 *
 * @param {{ targetDir?: string, adapter?: 'cloudflare' | 'node', ui?: boolean, install?: boolean, git?: boolean, skipHints?: boolean }} parsed
 * @param {{ interactive: boolean, prompts: import('./prompts.mjs').PromptAdapter, cwd: string }} ctx
 * @returns {Promise<ResolvedOptions>}
 */
export async function resolveOptions(parsed, { interactive, prompts, cwd }) {
  let targetDir = parsed.targetDir;
  if (!targetDir) {
    if (!interactive) {
      throw new Error('error: a project directory is required');
    }
    targetDir = (
      await prompts.text({
        message: 'Project directory:',
        placeholder: 'my-app',
        validate: (v) => validateDirName(v, cwd),
      })
    ).trim();
  }

  let adapter = parsed.adapter;
  if (adapter === undefined) {
    adapter = interactive ? await prompts.selectAdapter() : 'cloudflare';
  }

  let ui = parsed.ui;
  if (ui === undefined) {
    ui = interactive
      ? await prompts.confirm({
          message: 'Add hono-preact-ui components?',
          initialValue: false,
        })
      : false;
  }

  let install = parsed.install;
  if (install === undefined) {
    install = interactive
      ? await prompts.confirm({
          message: 'Install dependencies now?',
          initialValue: true,
        })
      : true;
  }

  let git = parsed.git;
  if (git === undefined) {
    git = interactive
      ? await prompts.confirm({
          message: 'Initialize a git repository?',
          initialValue: true,
        })
      : true;
  }

  return {
    targetDir,
    adapter,
    ui,
    install,
    git,
    skipHints: Boolean(parsed.skipHints),
  };
}
