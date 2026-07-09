import { existsSync, readdirSync, statSync } from 'node:fs';
import { resolve as resolvePath, basename } from 'node:path';

// A project name is substituted into generated files -- most consequentially the
// `package.json` `name` field and the Cloudflare `deploy` script (via
// `{{name_underscore}}`). Restrict it to a strict slug so a name can never carry
// JSON-breaking quotes or shell metacharacters into those sinks (an install-time
// `postinstall` breakout, or a `deploy`-time command injection). Must start with
// a letter or digit, then letters/digits/`.`/`_`/`-` only. This also rules out
// `..` and leading-dot names.
const PROJECT_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * Validate the final path segment of a target directory as a project name.
 * Returns an error string when it contains anything outside the safe slug set,
 * or undefined when it is acceptable. The name reaches `package.json` and shell
 * scripts by textual substitution, so this is a security boundary, not cosmetics.
 *
 * @param {string} name the project name (a directory basename)
 * @returns {string | undefined}
 */
export function validateProjectName(name) {
  if (!PROJECT_NAME_RE.test(name)) {
    return (
      `Invalid project name '${name}'. Use only letters, numbers, '.', '_', ` +
      `and '-', starting with a letter or number.`
    );
  }
  return undefined;
}

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
 * Single source of truth for whether a resolved target path is usable as a fresh
 * project directory. Returns an error message when the path already exists as a
 * file, or as a non-empty directory; returns undefined when it does not exist or
 * is an empty directory. Used by both the interactive prompt validator and the
 * flag-supplied-dir guard, so the two never diverge.
 *
 * @param {string} dest absolute target path
 * @param {string} name the name to show in the message
 * @returns {string | undefined}
 */
export function checkTargetDir(dest, name) {
  if (!existsSync(dest)) return undefined;
  if (!statSync(dest).isDirectory()) {
    return `A file named '${name}' already exists.`;
  }
  if (readdirSync(dest).length > 0) {
    return `Directory '${name}' already exists and is not empty.`;
  }
  return undefined;
}

/**
 * Validate a project directory name for the interactive prompt: reject an empty
 * or whitespace-only name, and reject a target that already exists as a file or
 * a non-empty directory (an empty existing directory is allowed). Returns an
 * error string to show, or undefined when the name is acceptable.
 *
 * @param {string} value the raw prompt input
 * @param {string} cwd directory the target is resolved against
 * @returns {string | undefined}
 */
export function validateDirName(value, cwd) {
  const name = value.trim();
  if (name.length === 0) return 'A project directory is required.';
  const dest = resolvePath(cwd, name);
  const nameError = validateProjectName(basename(dest));
  if (nameError) return nameError;
  return checkTargetDir(dest, name);
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
