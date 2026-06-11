import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GENERATED_ENTRY_WRAPPER_RELATIVE } from '../server-entry.js';

const here = resolve(fileURLToPath(import.meta.url), '..');

describe('scaffolder template parity', () => {
  it("cloudflare wrangler.jsonc 'main' points at the generated entry wrapper", () => {
    // The scaffolded template cannot import this constant, so this test is
    // the drift guard between the plugin's generated-entry path and the
    // wrangler config the scaffolder ships.
    const wranglerPath = resolve(
      here,
      '../../../create-hono-preact/templates/cloudflare/wrangler.jsonc'
    );
    const raw = readFileSync(wranglerPath, 'utf8');
    const main = /"main"\s*:\s*"([^"]+)"/.exec(raw)?.[1];
    expect(main).toBe(GENERATED_ENTRY_WRAPPER_RELATIVE);
  });
});
