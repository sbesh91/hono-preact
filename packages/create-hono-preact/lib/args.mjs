/**
 * @param {string[]} argv
 * @returns {
 *   { kind: 'help' } |
 *   { kind: 'version' } |
 *   { kind: 'error', message: string } |
 *   { kind: 'add-agents', force: boolean } |
 *   { kind: 'scaffold', targetDir: string | undefined, adapter: 'cloudflare' | 'node' | undefined, ui: boolean | undefined, install: boolean | undefined, git: boolean | undefined, yes: boolean, skipHints: boolean }
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
  /** @type {'cloudflare' | 'node' | undefined} */
  let adapter;
  /** @type {boolean | undefined} */
  let ui;
  /** @type {boolean | undefined} */
  let install;
  /** @type {boolean | undefined} */
  let git;
  let yes = false;
  let skipHints = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') return { kind: 'help' };
    if (arg === '--version' || arg === '-v') return { kind: 'version' };
    if (arg === '--yes' || arg === '-y') {
      yes = true;
    } else if (arg === '--skip-hints') {
      skipHints = true;
    } else if (arg === '--no-install') {
      install = false;
    } else if (arg === '--no-git') {
      git = false;
    } else if (arg === '--ui') {
      ui = true;
    } else if (arg === '--no-ui') {
      ui = false;
    } else if (arg === '--adapter' || arg.startsWith('--adapter=')) {
      const value = arg.includes('=')
        ? arg.slice('--adapter='.length)
        : argv[++i];
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

  return { kind: 'scaffold', targetDir, adapter, ui, install, git, yes, skipHints };
}
