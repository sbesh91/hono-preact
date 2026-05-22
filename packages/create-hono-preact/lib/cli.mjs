import { readdir, mkdir } from 'node:fs/promises';
import { spawn as realSpawn } from 'node:child_process';
import readline from 'node:readline/promises';
import { resolve, join, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pc from 'picocolors';
import { parseArgs } from './args.mjs';
import { detectPackageManager } from './detect-pm.mjs';
import { copyTemplate, renameDotfiles, substituteName } from './template.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const templatesRoot = resolve(here, '..', 'templates');

/**
 * @param {{
 *   argv: string[],
 *   cwd: string,
 *   env: Record<string, string | undefined>,
 *   spawnFn?: typeof realSpawn,
 *   prompt?: (message: string) => Promise<string>,
 * }} opts
 * @returns {Promise<number>} exit code (0 on success)
 */
export async function run({
  argv,
  cwd,
  env,
  spawnFn = realSpawn,
  prompt = defaultPrompt,
}) {
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

  let { targetDir, adapter, install, git } = parsed;

  if (!targetDir) {
    const answer = (await prompt('Project directory name: ')).trim();
    if (!answer) {
      console.error('error: a project directory name is required');
      return 1;
    }
    targetDir = answer;
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

  const pm = detectPackageManager(env);

  if (install) {
    const installExit = await runChild(spawnFn, pm, ['install'], targetPath);
    if (installExit !== 0) return 1;
  }

  if (git) {
    const gitExit = await runChild(spawnFn, 'git', ['init'], targetPath);
    if (gitExit !== 0) {
      console.warn(
        'warning: git init failed (is git installed?); continuing without git'
      );
    }
  }

  printNextSteps(targetDir, pm, install);
  return 0;
}

/**
 * @param {typeof realSpawn} spawnFn
 * @param {string} cmd
 * @param {string[]} args
 * @param {string} cwd
 * @returns {Promise<number>}
 */
function runChild(spawnFn, cmd, args, cwd) {
  return new Promise((res) => {
    const child = spawnFn(cmd, args, { cwd, stdio: 'inherit' });
    child.on('close', (code) => res(code ?? 0));
  });
}

/**
 * @param {string} targetDir
 * @param {string} pm
 * @param {boolean} installed
 */
function printNextSteps(targetDir, pm, installed) {
  const dev = pm === 'npm' ? 'npm run dev' : `${pm} dev`;
  console.log('');
  console.log(pc.green(pc.bold('Done!')) + ' Next steps:');
  console.log('');
  console.log(`  cd ${targetDir}`);
  if (!installed) {
    const installCmd = pm === 'npm' ? 'npm install' : `${pm} install`;
    console.log(`  ${installCmd}`);
  }
  console.log(`  ${dev}`);
  console.log('');
}

/**
 * @param {string} message
 * @returns {Promise<string>}
 */
async function defaultPrompt(message) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    return await rl.question(message);
  } finally {
    rl.close();
  }
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
