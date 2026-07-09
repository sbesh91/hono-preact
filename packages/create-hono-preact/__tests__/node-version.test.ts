import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  nodeVersionError,
  SUPPORTED_NODE_RANGE,
} from '../lib/node-version.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');

function enginesNode(pkgPath: string): string {
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  return pkg.engines.node;
}

describe('SUPPORTED_NODE_RANGE stays in sync with package.json engines', () => {
  it('matches create-hono-preact package.json engines.node', () => {
    expect(SUPPORTED_NODE_RANGE).toBe(
      enginesNode(resolve(here, '..', 'package.json'))
    );
  });

  it('matches hono-preact package.json engines.node', () => {
    expect(SUPPORTED_NODE_RANGE).toBe(
      enginesNode(resolve(repoRoot, 'packages/hono-preact/package.json'))
    );
  });
});

describe('nodeVersionError', () => {
  it.each(['v22.18.0', 'v22.19.3', 'v24.11.0', 'v24.12.1', 'v25.0.0'])(
    'accepts supported version %s',
    (v) => {
      expect(nodeVersionError(v)).toBeUndefined();
    }
  );

  it.each(['v20.11.1', 'v21.7.0', 'v22.17.9', 'v23.5.0', 'v24.10.9'])(
    'rejects unsupported version %s with the range and the running version',
    (v) => {
      const err = nodeVersionError(v);
      expect(err).toContain(SUPPORTED_NODE_RANGE);
      expect(err).toContain(v);
    }
  );

  it('fails open on an unparseable version string', () => {
    expect(nodeVersionError('weird-build')).toBeUndefined();
  });
});
