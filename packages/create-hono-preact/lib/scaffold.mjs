import { join, basename } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import {
  copyTreeExcept,
  composePackageJson,
  renameDotfiles,
  substituteName,
  copyAgentGuidance,
} from './template.mjs';

/**
 * Compose a project from the base template plus the chosen adapter and feature
 * overlays. Every file except package.json copies with last-write-wins overlay
 * semantics; package.json is produced by deep-merging the per-overlay fragments.
 *
 * @param {string} targetDir absolute destination
 * @param {{ adapter: 'cloudflare' | 'node', ui: boolean }} options
 * @param {string} templatesRoot absolute path to templates/
 */
export async function scaffold(targetDir, options, templatesRoot) {
  const overlayDirs = [
    join(templatesRoot, 'base'),
    join(templatesRoot, 'adapter', options.adapter),
  ];
  if (options.ui) overlayDirs.push(join(templatesRoot, 'feature', 'ui'));

  await mkdir(targetDir, { recursive: true });

  for (const dir of overlayDirs) {
    await copyTreeExcept(dir, targetDir, ['package.json']);
  }

  const name = basename(targetDir);
  const pkg = await composePackageJson(
    overlayDirs.map((dir) => join(dir, 'package.json'))
  );
  // Set the package name STRUCTURALLY (not via the later textual {{name}}
  // substitution) so JSON.stringify escapes it. This is defense-in-depth behind
  // the slug validation in resolve.mjs: even a name that slipped the validator
  // cannot break out of the JSON string to inject a sibling `scripts` key.
  pkg.name = name;
  await writeFile(
    join(targetDir, 'package.json'),
    JSON.stringify(pkg, null, 2) + '\n'
  );

  await renameDotfiles(targetDir);
  await substituteName(targetDir, name);
  await copyAgentGuidance(join(templatesRoot, 'agents'), targetDir, {
    force: true,
  });
}
