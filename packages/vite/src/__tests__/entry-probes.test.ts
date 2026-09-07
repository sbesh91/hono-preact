import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import { flipsGeneratedEntry, type EntryProbes } from '../entry-probes.js';

const ROOT = path.resolve('/proj');
const API = path.join(ROOT, 'src', 'api.ts');
const APP_CONFIG = path.join(ROOT, 'src', 'app-config.ts');
const SERVER_DIR = path.join(ROOT, 'src', 'server');

function probes(over: Partial<EntryProbes> = {}): EntryProbes {
  return {
    api: { candidate: API, resolved: API },
    appConfig: { candidate: APP_CONFIG, resolved: APP_CONFIG },
    serverDir: { abs: SERVER_DIR, existed: true },
    ...over,
  };
}

describe('flipsGeneratedEntry: api.ts / app-config.ts', () => {
  it('flips when a file that was absent at config time is created', () => {
    const p = probes({ api: { candidate: API, resolved: undefined } });
    expect(flipsGeneratedEntry(p, 'add', API)).toBe(true);
  });

  it('flips when a file that was present at config time is deleted', () => {
    expect(flipsGeneratedEntry(probes(), 'unlink', API)).toBe(true);
  });

  it('does not flip when a present file is re-added (no change in answer)', () => {
    // A rewrite can emit `add` for a file that already existed. The generated
    // entry already imports it, so restarting would be pure churn.
    expect(flipsGeneratedEntry(probes(), 'add', API)).toBe(false);
  });

  it('does not flip when an absent file is unlinked', () => {
    const p = probes({ api: { candidate: API, resolved: undefined } });
    expect(flipsGeneratedEntry(p, 'unlink', API)).toBe(false);
  });

  it('tracks app-config independently of api', () => {
    const p = probes({
      appConfig: { candidate: APP_CONFIG, resolved: undefined },
    });
    expect(flipsGeneratedEntry(p, 'add', APP_CONFIG)).toBe(true);
    expect(flipsGeneratedEntry(p, 'add', API)).toBe(false);
  });

  it('ignores an unrelated file', () => {
    expect(
      flipsGeneratedEntry(probes(), 'add', path.join(ROOT, 'src', 'other.ts'))
    ).toBe(false);
  });

  it('matches the candidate path, not the resolved one', () => {
    // The whole point of retaining `candidate`: when the probe answered
    // "absent", there is no resolved path to compare an event against.
    const p = probes({ api: { candidate: API, resolved: undefined } });
    expect(flipsGeneratedEntry(p, 'add', API)).toBe(true);
  });
});

describe('flipsGeneratedEntry: the server registry folder', () => {
  it('flips on the first module under a server dir that was absent at config time', () => {
    const p = probes({ serverDir: { abs: SERVER_DIR, existed: false } });
    expect(
      flipsGeneratedEntry(p, 'add', path.join(SERVER_DIR, 'a.server.ts'))
    ).toBe(true);
  });

  it('does not flip when the server dir existed: the emitted glob is live in dev', () => {
    expect(
      flipsGeneratedEntry(probes(), 'add', path.join(SERVER_DIR, 'a.server.ts'))
    ).toBe(false);
  });

  it('never flips on unlink under the server dir', () => {
    const p = probes({ serverDir: { abs: SERVER_DIR, existed: false } });
    expect(
      flipsGeneratedEntry(p, 'unlink', path.join(SERVER_DIR, 'a.server.ts'))
    ).toBe(false);
  });

  it('does not treat a sibling with the same prefix as being inside the dir', () => {
    // `src/server-utils/x.ts` starts with `src/server` textually; the
    // separator is what makes the containment check correct.
    const p = probes({ serverDir: { abs: SERVER_DIR, existed: false } });
    expect(
      flipsGeneratedEntry(p, 'add', `${SERVER_DIR}-utils${path.sep}x.ts`)
    ).toBe(false);
  });

  it('does not flip on the server dir itself, only on a module inside it', () => {
    const p = probes({ serverDir: { abs: SERVER_DIR, existed: false } });
    expect(flipsGeneratedEntry(p, 'add', SERVER_DIR)).toBe(false);
  });
});
