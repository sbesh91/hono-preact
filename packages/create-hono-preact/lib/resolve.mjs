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
 * Resolve parsed flags into a complete option set. In interactive mode, prompt
 * for any field a flag did not supply. In non-interactive mode, fill defaults
 * (adapter cloudflare, ui off, install on, git on); a missing target directory
 * is an error.
 *
 * @param {{ targetDir?: string, adapter?: 'cloudflare' | 'node', ui?: boolean, install?: boolean, git?: boolean, skipHints?: boolean }} parsed
 * @param {{ interactive: boolean, prompts: import('./prompts.mjs').PromptAdapter }} ctx
 * @returns {Promise<ResolvedOptions>}
 */
export async function resolveOptions(parsed, { interactive, prompts }) {
  let targetDir = parsed.targetDir;
  if (!targetDir) {
    if (!interactive) {
      throw new Error('error: a project directory is required');
    }
    targetDir = await prompts.text({
      message: 'Project directory:',
      placeholder: 'my-app',
      validate: (v) =>
        v.length === 0 ? 'A project directory is required.' : undefined,
    });
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
