import { readFileSync } from 'node:fs';
import { spawn as realSpawn } from 'node:child_process';
import { resolve, join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import pc from 'picocolors';
import { parseArgs } from './args.mjs';
import { detectPackageManager } from './detect-pm.mjs';
import { copyAgentGuidance } from './template.mjs';
import { scaffold } from './scaffold.mjs';
import {
  resolveOptions,
  checkTargetDir,
  validateProjectName,
} from './resolve.mjs';
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
 *   stdin?: import('node:stream').Readable & { isTTY?: boolean },
 *   platform?: NodeJS.Platform,
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
  stdin = process.stdin,
  platform = process.platform,
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

  // Non-interactive with a piped stdin and no positional dir: read the project
  // directory from stdin (preserves `printf 'name' | npm create hono-preact`).
  let targetDirArg = parsed.targetDir;
  if (
    targetDirArg === undefined &&
    !interactive &&
    stdin &&
    stdin.isTTY === false
  ) {
    const line = (await readFirstLine(stdin)).trim();
    if (line) targetDirArg = line;
  }

  // Validate a known target dir (positional or stdin) before prompting for
  // anything else, so a wizard's worth of answers is never collected and then
  // discarded. A prompted dir is validated inline by resolveOptions instead.
  // The project-name check runs first: the name is substituted into
  // package.json / shell scripts, so a hostile name must be rejected before any
  // filesystem work (checkTargetDir) or scaffolding runs.
  if (targetDirArg !== undefined) {
    const targetPath = resolve(cwd, targetDirArg);
    const reason =
      validateProjectName(basename(targetPath)) ??
      checkTargetDir(targetPath, targetDirArg);
    if (reason) {
      if (interactive) prompts.cancel(reason);
      else console.error(`error: ${reason}`);
      return 1;
    }
  }

  /** @type {import('./resolve.mjs').ResolvedOptions} */
  let options;
  try {
    options = await resolveOptions(
      { ...parsed, targetDir: targetDirArg },
      { interactive, prompts, cwd }
    );
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  }
  const { targetDir, adapter, ui, install, git, skipHints } = options;

  const targetPath = resolve(cwd, targetDir);

  const spin = interactive ? prompts.spinner() : null;
  spin?.start('Scaffolding project...');
  await scaffold(targetPath, { adapter, ui }, templatesRoot);
  spin?.stop('Project scaffolded');

  const pm = detectPackageManager(env);

  if (install) {
    spin?.start('Installing dependencies...');
    // Interactive mode hides the child behind a spinner, so capture its output
    // and surface it on failure; non-interactive inherits the terminal.
    const { code, output } = await runChild(
      spawnFn,
      pm,
      ['install'],
      targetPath,
      interactive ? 'capture' : 'inherit',
      platform
    );
    if (code !== 0) {
      if (interactive) {
        // clack status code 2 renders the error glyph (1 is the cancel glyph).
        spin?.stop('Dependency install failed', 2);
        const captured = output.trim();
        if (captured) console.error(captured);
      }
      console.error(`error: '${pm} install' failed in ${targetDir}.`);
      return 1;
    }
    spin?.stop('Dependencies installed');
  }

  if (git) {
    const { code } = await runChild(
      spawnFn,
      'git',
      ['init'],
      targetPath,
      interactive ? 'ignore' : 'inherit',
      platform
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
 * Run a child process. `mode` is 'inherit' (child writes to the terminal),
 * 'ignore' (discard output), or 'capture' (collect stdout+stderr and return it
 * in `output`). Resolves with the exit code and any captured output. A child
 * terminated by a signal (close code null) is reported as a non-zero exit.
 *
 * On Windows, package managers and git are `.cmd`/`.bat` shims, which recent
 * Node refuses to spawn without a shell (surfacing as ENOENT). `shell: true`
 * routes the launch through cmd.exe so the shim resolves. The args here are
 * fixed literals (`install`, `init`), so there is nothing to shell-escape.
 *
 * @param {typeof realSpawn} spawnFn
 * @param {string} cmd
 * @param {string[]} args
 * @param {string} cwd
 * @param {'inherit' | 'ignore' | 'capture'} [mode]
 * @param {NodeJS.Platform} [platform]
 * @returns {Promise<{ code: number, output: string }>}
 */
function runChild(
  spawnFn,
  cmd,
  args,
  cwd,
  mode = 'inherit',
  platform = process.platform
) {
  const stdio = mode === 'capture' ? ['ignore', 'pipe', 'pipe'] : mode;
  return new Promise((res) => {
    const child = spawnFn(cmd, args, {
      cwd,
      stdio,
      shell: platform === 'win32',
    });
    let output = '';
    const collect = (/** @type {Buffer} */ chunk) => {
      output += chunk.toString();
    };
    child.stdout?.on?.('data', collect);
    child.stderr?.on?.('data', collect);
    let settled = false;
    const settle = (/** @type {number} */ code) => {
      if (settled) return;
      settled = true;
      res({ code, output });
    };
    // A signal kill gives (null, signal); treat that as a failure, not success.
    child.on('close', (code, signal) => settle(code ?? (signal ? 1 : 0)));
    // 'error' fires when the binary isn't found on PATH (ENOENT) etc.
    // Without this listener the Promise would hang and 'close' would never fire.
    child.on('error', (err) => {
      console.error(`error: failed to run '${cmd}': ${err.message}`);
      settle(127);
    });
  });
}

/**
 * Read the first line from a stream (used to accept a project directory from a
 * piped stdin in non-interactive mode). Resolves with the line without its
 * trailing newline, or whatever was buffered at end-of-stream.
 *
 * @param {import('node:stream').Readable & { off?: Function }} stream
 * @returns {Promise<string>}
 */
function readFirstLine(stream) {
  return new Promise((res) => {
    let buf = '';
    const done = (/** @type {string} */ value) => {
      stream.off?.('data', onData);
      stream.off?.('end', onEnd);
      stream.off?.('error', onEnd);
      res(value);
    };
    const onData = (/** @type {Buffer} */ chunk) => {
      buf += chunk.toString();
      const nl = buf.indexOf('\n');
      if (nl !== -1) done(buf.slice(0, nl));
    };
    const onEnd = () => done(buf);
    stream.on('data', onData);
    stream.on('end', onEnd);
    stream.on('error', onEnd);
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
