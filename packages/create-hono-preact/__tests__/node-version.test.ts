import { describe, it, expect } from 'vitest';
import {
  nodeVersionError,
  SUPPORTED_NODE_RANGE,
} from '../lib/node-version.mjs';

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
