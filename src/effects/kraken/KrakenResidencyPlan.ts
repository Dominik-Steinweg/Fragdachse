export type KrakenAssetRole = 'water' | 'land' | 'tentacle' | 'egg';
export type KrakenResidencyPhase = 'intro' | 'water' | 'ashore' | 'land' | 'dead';
export interface KrakenPhaseOptions { waterMove?: boolean; prefetchLand?: boolean; activeEggs?: boolean; waterBody?: boolean }

/** Shared by the residency owner and the offline budget audit. Order defines load priority. */
export function krakenResidencyPlan(phase: KrakenResidencyPhase, options: KrakenPhaseOptions = {}) {
  const current: KrakenAssetRole[] = phase === 'intro' || phase === 'water' ? ['water', 'tentacle', 'egg']
    : phase === 'dead' ? [] : [...(phase === 'ashore' && options.waterBody !== false ? ['water' as const] : []), 'land', ...(options.activeEggs === false ? [] : ['egg' as const])];
  const required: [KrakenAssetRole, string][] = current.map(role => [role, '__rest']);
  const clips: [KrakenAssetRole, string][] = [];
  const add = (role: KrakenAssetRole, names: readonly string[]) => names.forEach(name => clips.push([role, name]));
  if (phase === 'intro') add('water', ['intro-rise']);
  if (phase === 'intro' || phase === 'water') {
    add('water', ['idle', 'ink-spit', 'egg-throw', 'dive', 'surface']);
    if (options.waterMove) add('water', ['move']);
    add('tentacle', ['rise', 'hover', 'slam', 'retract']);
  }
  if (phase === 'ashore') {
    // The crossing clip is urgent even when a burst skipped the HP prefetch window.
    add('land', ['ashore', 'idle', 'move']);
    if (options.waterBody !== false) add('water', ['idle', 'move']);
    add('land', ['ink-spit', 'slam', 'egg-throw']);
    // Defer the terminal clip until grip releases the water body; no two full bodies.
    if (options.waterBody === false) add('land', ['death']);
  }
  if (phase === 'land') add('land', ['idle', 'move', 'ink-spit', 'slam', 'egg-throw', 'death']);
  if (current.includes('egg')) add('egg', ['idle', 'hatch']);
  if (phase === 'water' && options.prefetchLand) add('land', ['__rest', 'ashore', 'idle', 'move']);
  return { required, clips };
}
