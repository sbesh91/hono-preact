import { describe, it, expect, vi } from 'vitest';
import { resolveOptions } from '../lib/resolve.mjs';

function stubPrompts(overrides = {}) {
  return {
    text: vi.fn(async () => 'prompted-dir'),
    selectAdapter: vi.fn(async () => 'node' as const),
    confirm: vi.fn(async () => true),
    intro: vi.fn(),
    outro: vi.fn(),
    note: vi.fn(),
    spinner: () => ({ start: vi.fn(), stop: vi.fn() }),
    ...overrides,
  };
}

const base = { yes: false, skipHints: false };

describe('resolveOptions — non-interactive', () => {
  it('applies defaults and never prompts', async () => {
    const prompts = stubPrompts();
    const opts = await resolveOptions(
      { ...base, targetDir: 'app' },
      { interactive: false, prompts }
    );
    expect(opts).toEqual({
      targetDir: 'app',
      adapter: 'cloudflare',
      ui: false,
      install: true,
      git: true,
      skipHints: false,
    });
    expect(prompts.text).not.toHaveBeenCalled();
    expect(prompts.selectAdapter).not.toHaveBeenCalled();
    expect(prompts.confirm).not.toHaveBeenCalled();
  });

  it('throws when targetDir is missing', async () => {
    await expect(
      resolveOptions(
        { ...base },
        { interactive: false, prompts: stubPrompts() }
      )
    ).rejects.toThrow(/project directory is required/i);
  });

  it('flag values override defaults', async () => {
    const opts = await resolveOptions(
      {
        ...base,
        targetDir: 'app',
        adapter: 'node',
        ui: true,
        install: false,
        git: false,
      },
      { interactive: false, prompts: stubPrompts() }
    );
    expect(opts).toMatchObject({
      adapter: 'node',
      ui: true,
      install: false,
      git: false,
    });
  });
});

describe('resolveOptions — interactive', () => {
  it('prompts only for fields not supplied by flags', async () => {
    const prompts = stubPrompts();
    const opts = await resolveOptions(
      { ...base, adapter: 'cloudflare' }, // adapter supplied; dir/ui/install/git prompted
      { interactive: true, prompts }
    );
    expect(prompts.text).toHaveBeenCalledTimes(1); // dir
    expect(prompts.selectAdapter).not.toHaveBeenCalled(); // adapter came from flag
    expect(prompts.confirm).toHaveBeenCalledTimes(3); // ui, install, git
    expect(opts).toEqual({
      targetDir: 'prompted-dir',
      adapter: 'cloudflare',
      ui: true,
      install: true,
      git: true,
      skipHints: false,
    });
  });
});
