import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  existsSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  copyTemplate,
  renameDotfiles,
  substituteName,
  copyAgentGuidance,
} from '../lib/template.mjs';

const here = resolve(fileURLToPath(import.meta.url), '..');
const fixture = join(here, 'fixtures', 'sample-template');

let target: string;
beforeEach(() => {
  target = mkdtempSync(join(tmpdir(), 'chp-template-test-'));
});
afterEach(() => {
  rmSync(target, { recursive: true, force: true });
});

describe('copyTemplate', () => {
  it('copies the entire fixture tree into the target dir', async () => {
    await copyTemplate(fixture, target);
    expect(existsSync(join(target, 'package.json'))).toBe(true);
    expect(existsSync(join(target, 'src', 'index.ts'))).toBe(true);
    expect(existsSync(join(target, '_gitignore'))).toBe(true);
  });
});

describe('renameDotfiles', () => {
  it('renames _gitignore to .gitignore', async () => {
    await copyTemplate(fixture, target);
    await renameDotfiles(target);
    expect(existsSync(join(target, '_gitignore'))).toBe(false);
    expect(existsSync(join(target, '.gitignore'))).toBe(true);
  });

  it('is a no-op when no _gitignore present', async () => {
    await renameDotfiles(target);
    expect(existsSync(join(target, '.gitignore'))).toBe(false);
  });
});

describe('substituteName', () => {
  it('replaces {{name}} in package.json', async () => {
    await copyTemplate(fixture, target);
    await substituteName(target, 'my-app');
    const pkg = JSON.parse(readFileSync(join(target, 'package.json'), 'utf8'));
    expect(pkg.name).toBe('my-app');
  });

  it('replaces {{name}} in README.md', async () => {
    await copyTemplate(fixture, target);
    await substituteName(target, 'my-app');
    const readme = readFileSync(join(target, 'README.md'), 'utf8');
    expect(readme).toContain('# my-app');
    expect(readme).not.toContain('{{name}}');
  });

  it('replaces {{name_underscore}} with the hyphen-to-underscore form', async () => {
    await copyTemplate(fixture, target);
    await substituteName(target, 'my-cool-app');
    const wrangler = readFileSync(join(target, 'wrangler.jsonc'), 'utf8');
    expect(wrangler).toContain('"name": "my-cool-app"');
    expect(wrangler).toContain('"main": "dist/my_cool_app/index.js"');
  });

  it('replaces {{name}} in nested source files', async () => {
    await copyTemplate(fixture, target);
    await substituteName(target, 'my-app');
    const src = readFileSync(join(target, 'src', 'index.ts'), 'utf8');
    expect(src).toContain('hello my-app');
    expect(src).not.toContain('{{name}}');
  });
});

describe('copyAgentGuidance', () => {
  it('creates root files and agents/ subtree when absent', async () => {
    const agentsDir = resolve(here, '..', 'templates', 'agents');
    const results = await copyAgentGuidance(agentsDir, target, {
      force: false,
    });
    expect(existsSync(join(target, 'AGENTS.md'))).toBe(true);
    expect(existsSync(join(target, 'CLAUDE.md'))).toBe(true);
    expect(existsSync(join(target, 'agents', 'llms-full.txt'))).toBe(true);
    expect(existsSync(join(target, 'agents', 'skills', 'add-a-page.md'))).toBe(
      true
    );
    const createdFiles = results
      .filter((r) => r.action === 'created')
      .map((r) => r.file);
    expect(createdFiles).toContain('AGENTS.md');
    expect(createdFiles).toContain('CLAUDE.md');
    expect(createdFiles).toContain(join('agents', 'llms-full.txt'));
  });

  it('skips an existing file without force', async () => {
    const agentsDir = resolve(here, '..', 'templates', 'agents');
    writeFileSync(join(target, 'AGENTS.md'), 'KEEP');
    const results = await copyAgentGuidance(agentsDir, target, {
      force: false,
    });
    expect(readFileSync(join(target, 'AGENTS.md'), 'utf8')).toBe('KEEP');
    expect(results[0]).toEqual({ file: 'AGENTS.md', action: 'skipped' });
  });

  it('overwrites an existing file with force', async () => {
    const agentsDir = resolve(here, '..', 'templates', 'agents');
    writeFileSync(join(target, 'AGENTS.md'), 'OLD');
    const results = await copyAgentGuidance(agentsDir, target, { force: true });
    expect(readFileSync(join(target, 'AGENTS.md'), 'utf8')).not.toBe('OLD');
    expect(results[0]).toEqual({ file: 'AGENTS.md', action: 'overwritten' });
  });
});
