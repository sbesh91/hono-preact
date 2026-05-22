import { readdir, mkdir } from 'node:fs/promises';
import { resolve, join, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from './args.mjs';
import { detectPackageManager } from './detect-pm.mjs';
import { copyTemplate, renameDotfiles, substituteName } from './template.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const templatesRoot = resolve(here, '..', 'templates');

/**
 * @param {{ argv: string[], cwd: string, env: Record<string, string | undefined> }} opts
 * @returns {Promise<number>} exit code (0 on success)
 */
export async function run({ argv, cwd, env }) {
  const parsed = parseArgs(argv);

  if (parsed.kind === 'help') {
    printHelp();
    return 0;
  }
  if (parsed.kind === 'version') {
    console.log('create-hono-preact 0.1.0');
    return 0;
  }
  if (parsed.kind === 'error') {
    console.error(parsed.message);
    printHelp();
    return 2;
  }

  let { targetDir, adapter } = parsed;

  if (!targetDir) {
    console.error('error: target directory is required');
    printHelp();
    return 2;
  }

  const targetPath = resolve(cwd, targetDir);

  try {
    const entries = await readdir(targetPath);
    if (entries.length > 0) {
      console.error(`error: target directory '${targetDir}' is not empty`);
      return 1;
    }
  } catch (err) {
    if (err && /** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') {
      await mkdir(targetPath, { recursive: true });
    } else {
      throw err;
    }
  }

  const sourceTemplate = join(templatesRoot, adapter);
  await copyTemplate(sourceTemplate, targetPath);
  await renameDotfiles(targetPath);
  await substituteName(targetPath, basename(targetPath));

  return 0;
}

function printHelp() {
  console.log(`Usage: create-hono-preact <target-dir> [options]

Scaffold a new hono-preact app.

Options:
  --adapter=<cloudflare|node>   pick the deployment target (default: cloudflare)
  --no-install                  skip dependency install
  --no-git                      skip 'git init'
  -h, --help                    show this help
  -v, --version                 show version`);
}
