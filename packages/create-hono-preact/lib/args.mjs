/**
 * @param {string[]} argv
 * @returns {
 *   { kind: 'help' } |
 *   { kind: 'version' } |
 *   { kind: 'error', message: string } |
 *   { kind: 'add-agents', force: boolean } |
 *   { kind: 'scaffold', targetDir: string | undefined, adapter: 'cloudflare' | 'node', install: boolean, git: boolean }
 * }
 */
export function parseArgs(argv) {
  if (argv[0] === 'add-agents') {
    let force = false;
    for (const arg of argv.slice(1)) {
      if (arg === '--force') force = true;
      else return { kind: 'error', message: `unknown flag: ${arg}` };
    }
    return { kind: 'add-agents', force };
  }

  let targetDir;
  let adapter = 'cloudflare';
  let install = true;
  let git = true;

  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') return { kind: 'help' };
    if (arg === '--version' || arg === '-v') return { kind: 'version' };
    if (arg === '--no-install') {
      install = false;
    } else if (arg === '--no-git') {
      git = false;
    } else if (arg.startsWith('--adapter=')) {
      const value = arg.slice('--adapter='.length);
      if (value !== 'cloudflare' && value !== 'node') {
        return {
          kind: 'error',
          message: `unknown adapter: ${value} (expected 'cloudflare' or 'node')`,
        };
      }
      adapter = value;
    } else if (arg.startsWith('-')) {
      return { kind: 'error', message: `unknown flag: ${arg}` };
    } else if (targetDir === undefined) {
      targetDir = arg;
    } else {
      return {
        kind: 'error',
        message: `unexpected positional argument: ${arg}`,
      };
    }
  }

  return { kind: 'scaffold', targetDir, adapter, install, git };
}

/**
 * Recover scaffold flags that `npm create` / `npm exec` strip from argv.
 *
 * npm parses long flags it doesn't recognize (e.g. `--adapter=node`) as its own
 * config: it prints `npm warn Unknown cli config "--adapter"`, drops the flag
 * from the argv handed to the initializer, and instead exposes it as a
 * `npm_config_<name>` environment variable. Without this recovery,
 * `npm create hono-preact app --adapter=node` (no `--` separator) would silently
 * scaffold the default adapter. pnpm, yarn, and bun forward bare flags as-is, so
 * this only ever fires under npm.
 *
 * Returns the flag tokens to append to argv before parsing. Anything already in
 * argv (e.g. passed via `npm create ... -- --adapter=node`) wins and is left
 * untouched. The durable invocation is the `--` form; this is a transitional
 * convenience tied to npm's current (deprecated) flag handling.
 *
 * @param {string[]} argv
 * @param {Record<string, string | undefined>} env
 * @returns {string[]} synthesized flag tokens (possibly empty)
 */
export function recoverNpmStrippedFlags(argv, env) {
  // The add-agents subcommand has its own flag set; never inject scaffold flags.
  if (argv[0] === 'add-agents') return [];

  const present = (/** @type {string} */ name) =>
    argv.some((arg) => arg === name || arg.startsWith(`${name}=`));

  const recovered = [];

  // `adapter` is our own config namespace, so any value present is unambiguous.
  // parseArgs validates it (node|cloudflare) once it's back in argv.
  if (!present('--adapter') && typeof env.npm_config_adapter === 'string') {
    recovered.push(`--adapter=${env.npm_config_adapter}`);
  }

  // `install` is not a real npm config, so npm represents the `--no-install`
  // negation as an empty string.
  if (!present('--no-install') && env.npm_config_install === '') {
    recovered.push('--no-install');
  }

  // `git` IS a real npm config (the git binary path, default "git"), so only the
  // literal "false" negation indicates `--no-git`; a configured path is not.
  if (!present('--no-git') && env.npm_config_git === 'false') {
    recovered.push('--no-git');
  }

  return recovered;
}
