#!/usr/bin/env node
import { run } from '../lib/cli.mjs';

run({
  argv: process.argv.slice(2),
  cwd: process.cwd(),
  env: process.env,
}).then(
  (code) => process.exit(code ?? 0),
  (err) => {
    console.error(err?.message ?? err);
    process.exit(1);
  }
);
