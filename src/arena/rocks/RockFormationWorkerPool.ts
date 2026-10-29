/**
 * One idle formation worker per Scene. Its module start-up (seconds while the boot is busy) then
 * overlaps asset loading, and the next World initialises the same worker again instead of starting
 * another one. Scenes without lifecycle events (headless tools, tests) never pool.
 */
interface WorkerPoolOwner { readonly events?: { once?(event: string, callback: () => void): unknown } }

const idle = new WeakMap<object, Worker>();
const guarded = new WeakSet<object>();

function spawn(): Worker {
  return new Worker(new URL('./RockFormationWorker.ts', import.meta.url), { type: 'module' });
}

function pooled(owner: WorkerPoolOwner): boolean {
  return typeof owner.events?.once === 'function';
}

/** The Scene's idle worker ends with the Scene; a restarted Scene pools again. */
function guardTeardown(owner: WorkerPoolOwner): void {
  if (guarded.has(owner)) return;
  guarded.add(owner);
  const end = (): void => {
    guarded.delete(owner);
    idle.get(owner)?.terminate();
    idle.delete(owner);
  };
  owner.events!.once!('shutdown', end);
  owner.events!.once!('destroy', end);
}

export function prewarmRockFormationWorker(owner: WorkerPoolOwner): void {
  if (!pooled(owner) || idle.has(owner) || typeof Worker === 'undefined') return;
  idle.set(owner, spawn());
  guardTeardown(owner);
}

/** `reused`: the worker may still deliver results for its previous World before `initialized`. */
export function acquireRockFormationWorker(owner: WorkerPoolOwner): { worker: Worker; reused: boolean } {
  const worker = idle.get(owner);
  if (!worker) return { worker: spawn(), reused: false };
  idle.delete(owner);
  return { worker, reused: true };
}

/** A failed worker is never handed to the next World. */
export function releaseRockFormationWorker(owner: WorkerPoolOwner, worker: Worker, reusable: boolean): void {
  worker.onmessage = null;
  worker.onerror = null;
  if (!reusable || !pooled(owner) || idle.has(owner)) { worker.terminate(); return; }
  idle.set(owner, worker);
  guardTeardown(owner);
}
