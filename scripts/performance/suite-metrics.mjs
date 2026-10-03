import { metric } from './metrics.mjs';

/** Equal weight per completed run, never pooled frames from unequal-duration runs. */
export function aggregateSuite(runs) {
  const valid = runs.filter(r => r.status === 'complete');
  const ids = [...new Set(valid.flatMap(r => r.windows.filter(w => w.kind === 'measurement').map(w => w.id)))];
  return ids.map(id => {
    const windows = valid.map(r => r.windows.find(w => w.id === id)).filter(Boolean);
    return { id, runs: windows.length, metrics: Object.fromEntries(['frame', 'cpu', 'gpu', 'drawCalls', 'heapBytes', 'textureRgbaBytes'].map(key =>
      [key, Object.fromEntries(['median', 'p95', 'p99'].map(p => [p, metric(windows.map(w => w[key]?.[p]))]))])),
      scopes: Object.fromEntries([...new Set(windows.flatMap(w => Object.keys(w.scopes ?? {})))].map(key =>
        [key, metric(windows.map(w => w.scopes[key]?.median))])),
      loads: windows.map(w => w.load), gpuStatus: [...new Set(windows.map(w => w.gpuStatus))] };
  });
}

export function compareSuiteGroups(left, right) {
  return [...new Set([...left, ...right].map(c => c.id))].map(id => {
    const a = left.find(c => c.id === id), b = right.find(c => c.id === id);
    if (!a || !b) return { id, status: 'n/a' };
    const warnings=[];
    for(const key of ['seed','buildSignature','spawnedEnemies','combatWaves','built','visualExplosions','trainDestroyed','layoutFingerprint']) {
      const values=c=>[...new Set((c.loads??[]).map(load=>load?.[key]).filter(value=>value!==undefined))].sort();
      if(JSON.stringify(values(a))!==JSON.stringify(values(b)))warnings.push(`Workload differs: ${key}`);
    }
    return { id, status: a.runs >= 3 && b.runs >= 3 ? 'measured' : 'insufficient-repetitions', runs: [a.runs, b.runs],
      warnings,
      metrics: Object.fromEntries(Object.keys(a.metrics).map(key => [key,
        Object.fromEntries(['median', 'p95', 'p99'].map(p => {
          const before = a.metrics[key]?.[p]?.median, after = b.metrics[key]?.[p]?.median;
          return [p, Number.isFinite(before) && Number.isFinite(after) ? { before, after, delta: after - before,
            percent: before > 0 ? (after / before - 1) * 100 : null } : null];
        }))])) };
  });
}
