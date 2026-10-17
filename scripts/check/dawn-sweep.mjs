#!/usr/bin/env node
// test:stress:dawn-sweep: the full Dawn arena acceptance sweep (500 seeds per template, every threat).
// Routine runs (test:stress:dawn, check:release) use a fixed sample; the shards still run in parallel.
//   npm run test:stress:dawn-sweep [-- <seeds>]
import { spawn } from 'node:child_process';
import { root } from './changes.mjs';

const seeds = process.argv[2] ?? '500';
if (!/^[1-9]\d*$/u.test(seeds)) throw Error(`Seed count must be a positive integer, got ${seeds}`);
const child = spawn('npm', ['run', 'test:stress:dawn'], {
  cwd: root, stdio: 'inherit', shell: process.platform === 'win32', env: { ...process.env, DAWN_STRESS_SEEDS: seeds },
});
child.on('exit', code => { process.exitCode = code ?? 1; });
