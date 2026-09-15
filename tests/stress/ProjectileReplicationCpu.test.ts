import { expect, it } from 'vitest';
import { encodeProjectileDynamic, decodeProjectileDynamics } from '../../src/network/projectileSnapshotCodec';
import { ProjectilePathRecorder } from '../../src/projectile/ProjectileFlightPath';
import type { SyncedProjectileDynamic } from '../../src/types';

/** Optional paired CPU experiment against an unmodified historical codec. See the benchmark
 * report for extracting that source; normal tests never require Git or an old checkout. */
it.skipIf(!process.env.PROJECTILE_LEGACY_CODEC)('compares both codecs on identical warmed path records', async () => {
  const legacy = await import(/* @vite-ignore */ process.env.PROJECTILE_LEGACY_CODEC!) as {
    encodeProjectileDynamic: typeof encodeProjectileDynamic;
    decodeProjectileDynamics: typeof decodeProjectileDynamics;
  };
  const results = [];
  for (const count of [8, 200]) for (const variablePhysics of [false, true]) {
    const records: SyncedProjectileDynamic[] = [];
    const recorder = new ProjectilePathRecorder();
    for (let id = 1; id <= count; id++) {
      let x = 0, y = id * 100, time = 0;
      const vx = Math.cos(id * 0.618) * 60, vy = Math.sin(id * 0.618) * 60;
      const epoch = 1_800_000_000_000;
      recorder.begin(id, x, y, vx, vy, epoch);
      for (let step = 0; step < 120; step++) {
        const dt = variablePhysics ? [1000 / 120, 1000 / 45, 1000 / 90, 1000 / 60][step % 4] : 1000 / 60;
        time += dt; x += vx * dt / 1000; y += vy * dt / 1000;
        recorder.append(id, x, y, vx, vy, epoch + Math.floor(time));
      }
      records.push({ id, x, y, vx, vy, size: 4, flightPath: recorder.read(id, epoch + Math.floor(time)) });
    }
    const oldEncode: number[] = [], newEncode: number[] = [], oldDecode: number[] = [], newDecode: number[] = [];
    for (let iteration = 0; iteration < 130; iteration++) {
      for (const old of iteration % 2 ? [true, false] : [false, true]) {
        const encode = old ? legacy.encodeProjectileDynamic : encodeProjectileDynamic;
        const decode = old ? legacy.decodeProjectileDynamics : decodeProjectileDynamics;
        const start = performance.now(), flat: (number | string)[] = [];
        for (const record of records) encode(flat, record);
        const text = JSON.stringify(flat), encodedAt = performance.now();
        const decoded = decode(JSON.parse(text)), decodedAt = performance.now();
        if (iteration === 0) expect(decoded).toEqual(records);
        if (iteration >= 30) {
          (old ? oldEncode : newEncode).push(encodedAt - start);
          (old ? oldDecode : newDecode).push(decodedAt - encodedAt);
        }
      }
    }
    const p95 = (values: number[]) => +values.sort((a, b) => a - b)[95].toFixed(3);
    results.push({ count, variablePhysics, pointsPerPath: records[0].flightPath!.points.length,
      oldEncodeP95Ms: p95(oldEncode), newEncodeP95Ms: p95(newEncode),
      oldDecodeP95Ms: p95(oldDecode), newDecodeP95Ms: p95(newDecode) });
    recorder.clear();
  }
  console.info('PROJECTILE_CODEC_CPU=' + JSON.stringify({ node: process.version, warmup: 30, samples: 100, results }));
}, 30_000);
