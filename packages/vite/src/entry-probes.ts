import * as path from 'node:path';
import * as fs from 'node:fs';
import type { ViteDevServer } from 'vite';

/**
 * What the `config` hook's existence probes found, in the shape the dev-server
 * watcher needs to detect a later flip.
 *
 * This exists as one record because the two hooks that share it run minutes
 * apart: `config` writes it, `configureServer` reads it. Carrying it as a
 * single value keeps that cross-hook protocol visible at the plugin's top
 * level and lets the flip rule below be tested without booting a dev server.
 */
export interface EntryProbes {
  /**
   * `candidate` is the path the probe checked; `resolved` is that same path
   * when the file existed and `undefined` when it did not. Both are needed:
   * the watcher matches events against the candidate, and decides whether an
   * event is a *change* by comparing against the resolved answer.
   */
  api: { candidate: string; resolved: string | undefined };
  appConfig: { candidate: string; resolved: string | undefined };
  /**
   * The blessed server-registry folder. Only its existence at config time
   * matters, hence a boolean rather than a resolved path.
   */
  serverDir: { abs: string; existed: boolean };
}

/**
 * Resolve `p` against `root` unless it is already absolute, then record
 * whether it exists. The probe pair the `config` hook needs for `api.ts` and
 * `app-config.ts`, which resolve identically and differ only in default path.
 */
export function probeOptionalFile(
  root: string,
  p: string
): { candidate: string; resolved: string | undefined } {
  const candidate = path.isAbsolute(p) ? p : path.resolve(root, p);
  return {
    candidate,
    resolved: fs.existsSync(candidate) ? candidate : undefined,
  };
}

/**
 * True when a watcher event would change what the `config` hook generates, so
 * the generated core app is now stale and only a restart can fix it.
 */
export function flipsGeneratedEntry(
  probes: EntryProbes,
  event: 'add' | 'unlink',
  file: string
): boolean {
  const abs = path.resolve(file);
  if (abs === probes.api.candidate) {
    return event === 'add'
      ? probes.api.resolved === undefined
      : probes.api.resolved !== undefined;
  }
  if (abs === probes.appConfig.candidate) {
    return event === 'add'
      ? probes.appConfig.resolved === undefined
      : probes.appConfig.resolved !== undefined;
  }
  // When src/server existed at startup, the emitted import.meta.glob is
  // live in dev and picks up new modules itself. When it was absent,
  // the generated entry has no glob at all, so only a restart can add
  // one.
  return (
    event === 'add' &&
    !probes.serverDir.existed &&
    abs.startsWith(probes.serverDir.abs + path.sep)
  );
}

/**
 * Restart the dev server when an existence probe's answer flips mid-session.
 *
 * The existence probes run only in the `config` hook, so creating or deleting
 * api.ts / app-config.ts (or adding the first module under a src/server folder
 * that was absent at startup) would otherwise change nothing until a manual
 * restart. The restart re-runs `config`, which regenerates the core app module
 * against the new file reality.
 *
 * Deliberately NOT addWatchFile: under Vite 8 it doubles as an import
 * registration, and watching an absent file 500s the module that "imports" it
 * (see route-server-autodiscovery.ts for the same trade).
 *
 * `readProbes` is a getter rather than a value because `configureServer` runs
 * after `config` but the watcher callbacks fire later still, and a restart
 * re-runs `config` with fresh probes. Reading through the getter on each event
 * keeps the rule evaluating against the current answers rather than a snapshot
 * taken at wiring time.
 */
export function watchProbeFlips(
  server: ViteDevServer,
  readProbes: () => EntryProbes | undefined
): void {
  const restartOn = (event: 'add' | 'unlink') => (file: string) => {
    const probes = readProbes();
    if (!probes) return;
    if (!flipsGeneratedEntry(probes, event, file)) return;
    void server.restart();
  };
  server.watcher.on('add', restartOn('add'));
  server.watcher.on('unlink', restartOn('unlink'));
}
