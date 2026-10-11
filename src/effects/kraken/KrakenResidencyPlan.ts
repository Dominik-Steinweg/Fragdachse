export type KrakenAssetRole = 'water' | 'land' | 'tentacle' | 'egg';
export type KrakenResidencyPhase = 'intro' | 'water' | 'ashore' | 'land' | 'dead';
export interface KrakenPhaseOptions { waterMove?: boolean; prefetchLand?: boolean; activeEggs?: boolean }

/** Shared by the residency owner and the offline budget audit. Order defines load priority. */
export function krakenResidencyPlan(phase: KrakenResidencyPhase, options: KrakenPhaseOptions = {}) {
  const current: KrakenAssetRole[] = phase === 'intro' || phase === 'water' ? ['water', 'tentacle', 'egg']
    : phase === 'dead' ? [] : [...(phase === 'ashore' ? ['water' as const] : []), 'land', ...(options.activeEggs === false ? [] : ['egg' as const])];
  const required: [KrakenAssetRole, string][] = current.map(role => [role, '__rest']);
  const clips: [KrakenAssetRole, string][] = [];
  const add = (role: KrakenAssetRole, names: readonly string[]) => names.forEach(name => clips.push([role, name]));
  if (phase === 'intro') add('water', ['intro-rise']);
  if (phase === 'intro' || phase === 'water') {
    add('water', ['idle', 'ink-spit', 'egg-throw', 'dive', 'surface']);
    if (options.waterMove) add('water', ['move']);
    add('tentacle', ['rise', 'hover', 'slam', 'retract']);
  }
  if (phase === 'ashore') { add('water', ['idle', 'move']); add('land', ['ashore']); }
  if (phase === 'ashore' || phase === 'land') add('land', ['idle', 'move', 'ink-spit', 'slam', 'egg-throw', 'death']);
  if (current.includes('egg')) add('egg', ['idle', 'hatch']);
  if (phase === 'water' && options.prefetchLand) add('land', ['__rest', 'ashore', 'idle', 'move', 'ink-spit', 'slam', 'egg-throw', 'death']);
  return { required, clips };
}
