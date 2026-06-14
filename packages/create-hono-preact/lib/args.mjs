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
