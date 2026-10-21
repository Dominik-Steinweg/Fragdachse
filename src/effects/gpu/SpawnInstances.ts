import { SPAWN_FIELD_LIFE_S, SPAWN_FLASH_S, SPAWN_KIND, SPAWN_VARIANT } from './SpawnShader';

/** One quad of the spawn layer; see SpawnShader for the meaning of kind, variant and p1..p4. */
export interface SpawnGpuInstance {
  x: number; y: number; kind: number; t0: number; seed: number; variant: number;
  r: number; g: number; b: number; scale: number;
  p1: number; p2: number; p3: number; p4: number;
}

interface ParticleRecipe {
  readonly gather: number; readonly sparks: number; readonly embers: number;
  readonly dust: number; readonly orbit: number;
}

/** Particle counts per spawn at full detail; the low quality profile scales them down. */
const PARTICLES: Readonly<Record<'player' | 'enemy', ParticleRecipe>> = {
  player: { gather: 36, sparks: 34, embers: 24, dust: 30, orbit: 10 },
  enemy: { gather: 12, sparks: 14, embers: 6, dust: 12, orbit: 0 },
};
/** Size of the enemy family relative to the player's. */
const ENEMY_SCALE = 0.66;
const TAU = Math.PI * 2;

/**
 * Builds every quad of one spawn: the field (glow, flash, light pool, column) and its particles.
 * Pure and deterministic for a given random source, so the shader review uses the same recipe as
 * the game. Returns the instances and how long the longest of them lives.
 */
export function buildSpawnInstances(
  x: number, y: number, colorHex: number, variant: number, share: number, random: () => number = Math.random,
): { instances: SpawnGpuInstance[]; lifeS: number } {
  const enemy = variant === SPAWN_VARIANT.enemy;
  const scale = enemy ? ENEMY_SCALE : 1;
  const counts = enemy ? PARTICLES.enemy : PARTICLES.player;
  const r = ((colorHex >> 16) & 0xff) / 255, g = ((colorHex >> 8) & 0xff) / 255, b = (colorHex & 0xff) / 255;
  const flash = SPAWN_FLASH_S[variant];
  const between = (min: number, max: number) => min + random() * (max - min);
  const quad = (kind: number, p1: number, p2: number, p3: number, p4: number): SpawnGpuInstance => ({
    x, y, kind, t0: 0, seed: random(), variant, r, g, b, scale, p1, p2, p3, p4,
  });
  const count = (n: number) => Math.round(n * share);
  const instances: SpawnGpuInstance[] = [quad(SPAWN_KIND.field, 0, 0, 0, 0)];
  let lifeS: number = SPAWN_FIELD_LIFE_S[variant];
  const offset = random() * TAU;

  // Light drawn in from all sides; the evenly spread angles keep the swirl full, not clumped.
  const gather = count(counts.gather);
  for (let i = 0; i < gather; i++) {
    instances.push(quad(SPAWN_KIND.gather, offset + (i / gather) * TAU + between(-0.3, 0.3),
      enemy ? between(30, 60) : between(46, 112), between(0.62, 1), between(1, 2.2)));
  }
  const sparks = count(counts.sparks);
  for (let i = 0; i < sparks; i++) {
    const life = enemy ? between(0.26, 0.48) : between(0.3, 0.7);
    instances.push(quad(SPAWN_KIND.spark, (i / sparks) * TAU + between(-0.35, 0.35),
      enemy ? between(110, 230) : between(170, 420), life, between(0.8, 1.5)));
    lifeS = Math.max(lifeS, flash + life);
  }
  // Soft puffs of light pushed outwards by the flash carry the wave instead of a hard ring.
  const dust = count(counts.dust);
  for (let i = 0; i < dust; i++) {
    const life = enemy ? between(0.4, 0.7) : between(0.5, 0.95);
    instances.push(quad(SPAWN_KIND.dust, (i / dust) * TAU + between(-0.25, 0.25),
      enemy ? between(20, 40) : between(32, 72), life, enemy ? between(3, 5) : between(4, 7.5)));
    lifeS = Math.max(lifeS, flash + life);
  }
  // Residual light circles the new figure once and unwinds outwards; scattered radii and speeds
  // keep the motes from lining up into a circle.
  const orbit = count(counts.orbit);
  for (let i = 0; i < orbit; i++) {
    const life = between(0.6, 1.2);
    instances.push(quad(SPAWN_KIND.orbit, random() * TAU, between(12, 42), life, between(1, 1.9)));
    lifeS = Math.max(lifeS, flash + life);
  }
  const embers = count(counts.embers);
  for (let i = 0; i < embers; i++) {
    const delay = between(0, 0.6), life = between(0.8, 1.5);
    instances.push(quad(SPAWN_KIND.ember, random() * TAU, delay, life, between(1, 1.8)));
    lifeS = Math.max(lifeS, flash + delay + life);
  }
  return { instances, lifeS };
}
