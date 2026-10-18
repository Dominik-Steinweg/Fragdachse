import lilies from '../assets/manifests/void-lilies.json';
import rockColonies from '../assets/manifests/void-rock-colonies.json';

/** Argon void botany (GDD Nachtsicht G2): colour atlases and their congruent emissive atlases. */
export const VOID_LILY_ATLAS = { ...lilies.atlas, key: 'woodland-void-lilies' };
export const VOID_LILY_EMISSIVE_ATLAS = { ...lilies.emissiveAtlas, key: 'woodland-void-lilies-emissive' };
export const VOID_ROCK_ATLAS = { ...rockColonies.atlas, key: 'woodland-void-rock-colonies' };
export const VOID_ROCK_EMISSIVE_ATLAS = { ...rockColonies.emissiveAtlas, key: 'woodland-void-rock-colonies-emissive' };
export const VOID_FLORA_ATLASES = [VOID_LILY_ATLAS, VOID_LILY_EMISSIVE_ATLAS, VOID_ROCK_ATLAS, VOID_ROCK_EMISSIVE_ATLAS];

const lilyFrames = lilies.assets.map(a => a.name);
const rockFrames = rockColonies.assets.map(a => ({ name: a.name, width: a.width, height: a.height }));

/** Early infection: mostly dark green-teal with the takeover only starting. Everything else is full. */
const EARLY_LILIES = new Set(['void-lily-pad-04', 'void-lily-pad-08', 'void-lily-group-01', 'void-lily-group-02', 'void-lily-group-04']);
/** The natural pair of pads keeps a pair; it never stands in for a single pad. */
const LILY_PAIRS: Readonly<Record<string, string>> = { 'lily-pad-03': 'void-lily-pad-06' };
const PAIR_FRAMES = new Set(Object.values(LILY_PAIRS));
/** Infestation from which the void art replaces a plant; the rim below keeps the natural plant. */
export const VOID_ART_FROM = .3;
const EARLY_BELOW = .7;

/**
 * Void art frame for a natural lily frame, or null when no art exists. A partly infested plant
 * shows an early-infection variant, a fully taken one a converted variant. `roll` is a stable
 * per-plant hash in [0, 1).
 */
export function voidLilyFrame(naturalFrame: string, amount: number, roll: number): string | null {
  const pair = LILY_PAIRS[naturalFrame];
  if (pair && lilyFrames.includes(pair)) return pair;
  const family = naturalFrame.startsWith('lily-group') ? 'void-lily-group-' : 'void-lily-pad-';
  const all = lilyFrames.filter(name => name.startsWith(family) && !PAIR_FRAMES.has(name));
  const early = amount < EARLY_BELOW;
  const tier = all.filter(name => EARLY_LILIES.has(name) === early);
  const pool = tier.length ? tier : all;
  return pool.length ? pool[Math.min(pool.length - 1, Math.floor(roll * pool.length))] : null;
}

/** Void art frame for a rock colony kind (moss-nest, lichen, …), or null while none is approved. */
export function voidRockFrame(kind: string, roll: number): { name: string; width: number; height: number } | null {
  const pool = rockFrames.filter(frame => frame.name.startsWith(`void-${kind}-`));
  return pool.length ? pool[Math.min(pool.length - 1, Math.floor(roll * pool.length))] : null;
}
