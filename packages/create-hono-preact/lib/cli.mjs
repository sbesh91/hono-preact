import { readFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { spawn as realSpawn } from 'node:child_process';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pc from 'picocolors';
import { parseArgs } from './args.mjs';
import { detectPackageManager } from './detect-pm.mjs';
import { copyAgentGuidance } from './template.mjs';
import { scaffold } from './scaffold.mjs';
import { resolveOptions } from './resolve.mjs';
import { clackPrompts, brandBanner } from './prompts.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const templatesRoot = resolve(here, '..', 'templates');

/**
 * @param {{
 *   argv: string[],
 *   cwd: string,
 *   env: Record<string, string | undefined>,
 *   isTTY?: boolean,
 *   prompts?: import('./prompts.mjs').PromptAdapter,
 *   spawnFn?: typeof realSpawn,
 * }} opts
 * @returns {Promise<number>} exit code (0 on success)
 */
export async function run({
  argv,
  cwd,
  env,
  isTTY = false,
  prompts = clackPrompts,
  spawnFn = realSpawn,
}) {
  const parsed = parseArgs(argv);

  if (parsed.kind === 'help') {
    printHelp();
    return 0;
  }
  if (parsed.kind === 'version') {
    const { version } = JSON.parse(
      readFileSync(resolve(here, '..', 'package.json'), 'utf8')
    );
    console.log(`create-hono-preact ${version}`);
    return 0;
  }
  if (parsed.kind === 'add-agents') {
    const agentsDir = join(templatesRoot, 'agents');
    const results = await copyAgentGuidance(agentsDir, cwd, {
      force: parsed.force,
    });
    for (const { file, action } of results) {
      if (action === 'skipped') {
        console.error(
          `skip: ${file} already exists (use --force to overwrite)`
        );
      } else {
        console.log(
          `${action === 'overwritten' ? 'overwrote' : 'created'} ${file}`
        );
      }
    }
    return results.every((r) => r.action === 'skipped') ? 1 : 0;
  }
  if (parsed.kind === 'error') {
    console.error(parsed.message);
    printHelp();
    return 2;
  }

  const interactive = Boolean(isTTY) && !parsed.yes;
  if (interactive) prompts.intro(brandBanner);

  /** @type {import('./resolve.mjs').ResolvedOptions} */
  let options;
  try {
    options = await resolveOptions(parsed, { interactive, prompts });
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  }
  const { targetDir, adapter, ui, install, git, skipHints } = options;

  const targetPath = resolve(cwd, targetDir);
  try {
    const entries = await readdir(targetPath);
    if (entries.length > 0) {
      console.error(`error: target directory '${targetDir}' is not empty`);
      return 1;
    }
  } catch (err) {
    if (
      !(err && /** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT')
    ) {
      throw err;
    }
    // Directory doesn't exist yet; scaffold() will create it.
  }

  const spin = interactive ? prompts.spinner() : null;
  spin?.start('Scaffolding project...');
  await scaffold(targetPath, { adapter, ui }, templatesRoot);
  spin?.stop('Project scaffolded');

  const pm = detectPackageManager(env);
  const childStdio = interactive ? 'ignore' : 'inherit';

  if (install) {
    spin?.start('Installing dependencies...');
    const code = await runChild(
      spawnFn,
      pm,
      ['install'],
      targetPath,
      childStdio
    );
    if (code !== 0) {
      if (interactive) {
        spin?.stop('Dependency install failed', 1);
        console.error(
          `Run '${pm} install' in ${targetDir} to see what failed.`
        );
      }
      return 1;
    }
    spin?.stop('Dependencies installed');
  }

  if (git) {
    const code = await runChild(
      spawnFn,
      'git',
      ['init'],
      targetPath,
      childStdio
    );
    if (code !== 0) {
      console.warn(
        'warning: git init failed (is git installed?); continuing without git'
      );
    }
  }

  if (!skipHints) {
    if (interactive) {
      const dev = pm === 'npm' ? 'npm run dev' : `${pm} dev`;
      const lines = [`cd ${targetDir}`];
      if (!install) lines.push(pm === 'npm' ? 'npm install' : `${pm} install`);
      lines.push(dev);
      prompts.note(lines.map((l) => `  ${l}`).join('\n'), 'Next steps');
    } else {
      printNextSteps(targetDir, pm, install);
    }
  }

  if (interactive) prompts.outro(pc.green("You're all set!"));
  return 0;
}

/**
 * @param {typeof realSpawn} spawnFn
 * @param {string} cmd
 * @param {string[]} args
 * @param {string} cwd
 * @param {import('node:child_process').StdioOptions} [stdio]
 * @returns {Promise<number>}
 */
function runChild(spawnFn, cmd, args, cwd, stdio = 'inherit') {
  return new Promise((res) => {
    const child = spawnFn(cmd, args, { cwd, stdio });
    let settled = false;
    const settle = (/** @type {number} */ code) => {
      if (settled) return;
      settled = true;
      res(code);
    };
    child.on('close', (code) => settle(code ?? 0));
    // 'error' fires when the binary isn't found on PATH (ENOENT) etc.
    // Without this listener the Promise would hang and 'close' would never fire.
    child.on('error', (err) => {
      console.error(`error: failed to run '${cmd}': ${err.message}`);
      settle(127);
    });
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

function printHelp() {
  console.log(`Usage: create-hono-preact <target-dir> [options]
       create-hono-preact add-agents [--force]

Scaffold a new hono-preact app.

Commands:
  add-agents [--force]          Add AGENTS.md, CLAUDE.md, and agent recipes to an existing project

Options:
  --adapter <cloudflare|node>   pick the deployment target (default: cloudflare)
  --ui, --no-ui                 include or exclude hono-preact-ui components
  --no-install                  skip dependency install
  --no-git                      skip 'git init'
  -y, --yes                     accept defaults for anything not specified
  --skip-hints                  suppress the "Next steps" note
  -h, --help                    show this help
  -v, --version                 show version`);
}
