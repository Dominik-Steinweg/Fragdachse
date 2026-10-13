import type { WeaponConfig } from '../loadout/LoadoutConfig';
import type { ProjectileExplosionConfig } from '../types';

const positive = (value: number): boolean => Number.isFinite(value) && value > 0;
const permitsBaseDamage = (multiplier: number | undefined): boolean => positive(multiplier ?? 1);

function explosionDamagesBases(effect: ProjectileExplosionConfig | undefined): boolean {
  if (!effect) return false;
  // HostUpdateCoordinator routes these payloads to fields instead of explosion combat.
  if (effect.timeBubble || effect.reinforcementMatrix || effect.overchargeField) return false;
  // WorldCombatCore rounds radial explosion damage before applying the base multiplier.
  if (effect.radius >= 0 && positive(Math.round(effect.maxDamage)) && permitsBaseDamage(effect.baseDamageMult)) return true;
  // FireSystem zone ticks reach applyRadialHostileBaseDamage independently of the blast.
  const ground = effect.groundFire;
  if (ground && positive(ground.radius) && positive(ground.lingerDuration)
    && positive(ground.damagePerTick) && permitsBaseDamage(ground.baseDamageMult)) return true;
  // Chunk landing explosions can damage structures; their burn stacks alone cannot.
  const chunks = effect.fireChunkBurst;
  return !!chunks && chunks.count > 0 && explosionDamagesBases(chunks.landingExplosion);
}

/**
 * Can one player-owned automated attack hurt a hostile base, before runtime buffs,
 * target eligibility, range and line of sight? This is not a figure-damage predicate.
 * Tesla returns false: AutomatedWeaponExecutionAdapter does not fire tesla_dome;
 * TeslaDomeSystem owns that field's separate base callbacks.
 */
export function canWeaponDamageBases(weapon: WeaponConfig): boolean {
  const fire = weapon.fire;
  switch (fire.type) {
    case 'projectile': {
      const cloud = fire.impactCloud;
      // Cloud ticks use their own base multiplier, not the direct hit's multiplier.
      if (cloud && positive(cloud.radius) && positive(cloud.damagePerTick)
        && cloud.duration > cloud.tickInterval && positive(cloud.tickInterval)
        && permitsBaseDamage(cloud.baseDamageMult)) return true;
      // A zero-bounce cloud consumes the projectile before an attached explosion.
      if (!(cloud && fire.projectileMaxBounces === 0) && explosionDamagesBases(fire.impactExplosion)) return true;
      // Base contacts suppress direct damage on explosive projectiles (except cloud contacts).
      return (!fire.impactExplosion || !!cloud && fire.projectileMaxBounces === 0)
        && positive(weapon.directDamageOverride ?? weapon.damage) && permitsBaseDamage(weapon.baseDamageMult);
    }
    case 'flamethrower':
      if ((fire.fireball?.enabled ?? 0) > 0) {
        // The specialized adapter replaces the flame with an explosive fireball.
        // Captured normal flames can also be emitted along its flight, independently
        // of the blast multiplier. Fireball ground trails are burn-only, not zone damage.
        return positive(Math.round(fire.fireball?.explosionMaxDamage ?? 90))
          && permitsBaseDamage(weapon.baseDamageMult)
          || weapon.fireballFlameConfig?.fire.type === 'flamethrower'
            && positive(weapon.fireballFlameConfig.damage);
      }
      // createFlame passes damage, but currently does NOT forward baseDamageMult.
      // Base contact applies that hit once; burnOnHit/burn stacks only affect figures.
      return positive(weapon.damage);
    case 'leaf_blower':
      // Like flames, the specialized direct payload omits baseDamageMult.
      return positive(weapon.directDamageOverride ?? weapon.damage);
    case 'hitscan':
      // Support hitscan is a separate PlasmaBurner execution capability.
      return !fire.supportEffect && positive(weapon.damage) && permitsBaseDamage(weapon.baseDamageMult);
    case 'melee':
      return (!fire.damageTargets || fire.damageTargets.includes('bases'))
        && positive(weapon.damage) && permitsBaseDamage(weapon.baseDamageMult);
    default:
      // Fields/support do not produce damaging automated shots. Enemy-hit explosions,
      // proximity pulses and externally triggered detonations are not base-contact payloads.
      return false;
  }
}

export interface BaseCell { readonly gridX: number; readonly gridY: number }
export interface ExposedBaseFace {
  readonly x1: number; readonly y1: number;
  readonly x2: number; readonly y2: number;
  readonly normalX: number; readonly normalY: number;
}

/** Cell coordinates match BaseEntity: offset + grid * cellSize is the top-left. */
export function computeExposedBaseFaces(input: {
  cells: readonly BaseCell[];
  cellSize: number; offsetX: number; offsetY: number;
  isCoveredCell: (gridX: number, gridY: number) => boolean;
}): readonly ExposedBaseFace[] {
  const { cells, cellSize, offsetX, offsetY, isCoveredCell } = input;
  const key = (x: number, y: number): string => `${x},${y}`;
  const occupied = new Set(cells.map(cell => key(cell.gridX, cell.gridY)));
  const faces: ExposedBaseFace[] = [];
  for (const { gridX, gridY } of cells) {
    const x = offsetX + gridX * cellSize, y = offsetY + gridY * cellSize;
    const add = (nx: number, ny: number, x1: number, y1: number, x2: number, y2: number): void => {
      if (!occupied.has(key(gridX + nx, gridY + ny)) && !isCoveredCell(gridX + nx, gridY + ny)) {
        faces.push({ x1, y1, x2, y2, normalX: nx, normalY: ny });
      }
    };
    add(-1, 0, x, y, x, y + cellSize);
    add(1, 0, x + cellSize, y, x + cellSize, y + cellSize);
    add(0, -1, x, y, x + cellSize, y);
    add(0, 1, x, y + cellSize, x + cellSize, y + cellSize);
  }
  return faces;
}

export class ExposedBaseFaceCache {
  private generation: number | undefined;
  private readonly entries = new Map<string, readonly ExposedBaseFace[]>();

  get(baseId: string, generation: number, compute: () => readonly ExposedBaseFace[]): readonly ExposedBaseFace[] {
    if (this.generation !== generation) {
      this.clear();
      this.generation = generation;
    }
    let faces = this.entries.get(baseId);
    if (!faces) {
      faces = compute();
      this.entries.set(baseId, faces);
    }
    return faces;
  }

  clear(): void {
    this.entries.clear();
    this.generation = undefined;
  }
}

export interface BaseAimPoint { readonly x: number; readonly y: number; readonly distance: number }

/**
 * Range and returned distance refer to the actual surface, before the LOS epsilon.
 * The caller checks visibility at the returned (outward-offset) x/y, never the center.
 */
export function rankBaseAimPoints(
  faces: readonly ExposedBaseFace[], fromX: number, fromY: number,
  range: number, limit: number, outwardOffset = 1,
): readonly BaseAimPoint[] {
  if (limit <= 0 || range < 0) return [];
  const points: (BaseAimPoint & { index: number })[] = [];
  faces.forEach((face, index) => {
    const dx = face.x2 - face.x1, dy = face.y2 - face.y1;
    const lengthSquared = dx * dx + dy * dy;
    const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1,
      ((fromX - face.x1) * dx + (fromY - face.y1) * dy) / lengthSquared));
    const x = face.x1 + t * dx, y = face.y1 + t * dy;
    if ((fromX - x) * face.normalX + (fromY - y) * face.normalY <= 0) return;
    const distance = Math.hypot(fromX - x, fromY - y);
    if (distance <= range) points.push({ x: x + outwardOffset * face.normalX,
      y: y + outwardOffset * face.normalY, distance, index });
  });
  points.sort((a, b) => a.distance - b.distance || a.index - b.index);
  return points.slice(0, Math.floor(limit)).map(({ x, y, distance }) => ({ x, y, distance }));
}
