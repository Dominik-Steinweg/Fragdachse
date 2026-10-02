import type * as Phaser from 'phaser';

type Probe = () => boolean;
const queues = new WeakMap<object, Set<Probe>>();
const listeners = new WeakMap<object, () => void>();
/** Optional world-owned probes join the existing scene warmup; world release removes its probe. */
export function registerEnemyMeshWarmup(scene: Phaser.Scene, probe: Probe): () => void {
  let queue = queues.get(scene); if (!queue) { queue = new Set(); queues.set(scene, queue); }
  queue.add(probe); listeners.get(scene)?.();
  return () => queue!.delete(probe);
}
export function subscribeEnemyMeshWarmup(scene: Phaser.Scene, wake: () => void): () => void {
  listeners.set(scene, wake); return () => { if (listeners.get(scene) === wake) listeners.delete(scene); };
}
export function prepareEnemyMeshWarmups(scene: Phaser.Scene): boolean {
  const queue = queues.get(scene); if (!queue?.size) return true;
  const probe = queue.values().next().value!;
  try { if (probe()) queue.delete(probe); }
  catch (error) { queue.delete(probe); console.warn('[EnemyMeshWarmup] Optional probe failed', error); }
  return queue.size === 0;
}
