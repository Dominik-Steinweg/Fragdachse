import type { WorldScopedBinding } from './WorldRuntime';
import type { CombatSystem } from '../systems/CombatSystem';
import type { ProjectileSpawnPort } from '../projectile/ProjectileSpawnPort';
import type { WeaponConfig } from '../loadout/LoadoutConfig';
import {
  WeaponFireExecutor,
  getHitscanRequestRange,
  type WeaponExecutionCapability,
  type WeaponFireParams,
} from '../loadout/WeaponFireExecutor';

/** Combat-Senke des gemeinsamen Immediate-Fire-Pfads (Hitscan/Melee). */
type WeaponFireCombatResolver =
  Pick<CombatSystem, 'resolveHitscanShot' | 'resolveMeleeSwing'>
  & Partial<Pick<CombatSystem, 'resolveSafeHitscanStart'>>;

export interface WorldWeaponExecutionRuntimeOptions {
  readonly projectileSpawn: ProjectileSpawnPort;
  readonly combatSystem: WeaponFireCombatResolver;
}

/**
 * World-composed Owner der gemeinsamen Immediate-Weapon-Execution-Capability
 * (Cross-Phase-Contract-Familie `WeaponExecutionCapability`, eingeführt in Teilphase 4A).
 *
 * Er besitzt den zustandsarmen {@link WeaponFireExecutor} und verdrahtet dessen `WeaponFireSink`
 * **einmalig** mit dem semantischen Projectile-Spawn-Port und den unveränderten Legacy-Combat-
 * Pfaden. Kein Player-Resource-/Loadout-Wissen, keine Projectile-internen Regeln: Player, Gegner,
 * Türme und Allies rufen `fire()` mit derselben `WeaponConfig`. Der `LoadoutManager` delegiert
 * seinen Player-Fire hierher.
 */
export class WorldWeaponExecutionRuntime implements WorldScopedBinding, WeaponExecutionCapability {
  private readonly executor: WeaponFireExecutor;

  constructor(options: WorldWeaponExecutionRuntimeOptions) {
    const { projectileSpawn, combatSystem } = options;
    this.executor = new WeaponFireExecutor({
      spawnProjectile: (request) => projectileSpawn.spawnProjectile(request),
      resolveHitscan: (request) => {
        const shooterX = request.shooterX ?? request.startX;
        const shooterY = request.shooterY ?? request.startY;
        const resolvedStart = combatSystem.resolveSafeHitscanStart
          ? combatSystem.resolveSafeHitscanStart(shooterX, shooterY, request.startX, request.startY)
          : { x: request.startX, y: request.startY };
        const resolvedRange = getHitscanRequestRange(request, resolvedStart.x, resolvedStart.y, request.angle);
        return combatSystem.resolveHitscanShot(
          request.shooterId,
          resolvedStart.x,
          resolvedStart.y,
          request.angle,
          resolvedRange,
          request.damage,
          request.traceThickness,
          request.color,
          request.adrenalinGain,
          request.sourceId,
          request.visualPreset,
          request.shotAudioKey,
          request.sourceSlot,
          request.shotId,
          request.detonator,
          request.rockDamageMult,
          request.trainDamageMult,
          request.chainLightning,
          request.burnOnHit,
          request.supportEffect,
          request.visualMuzzleOrigin,
          request.baseDamageMult,
        );
      },
      resolveMelee: (request) => combatSystem.resolveMeleeSwing(
        request.shooterId,
        request.x,
        request.y,
        request.angle,
        request.range,
        request.arcDegrees,
        request.damage,
        request.adrenalinGain,
        request.sourceId,
        request.color,
        request.sourceSlot,
        request.rockDamageMult,
        request.trainDamageMult,
        request.visualPreset,
        request.shotAudioKey,
        request.burnOnHit,
        undefined,
        request.hitHeal,
        request.hitAdrenaline,
        request.bloodEffectMultiplier,
        request.damageTargets,
        request.baseDamageMult,
      ) ?? false,
    });
  }

  fire(config: WeaponConfig, params: WeaponFireParams): boolean {
    return this.executor.fire(config, params);
  }

  destroy(): void {
    // Zustandsarm: der Executor hält keinen world-scoped State. Spawn-Port und Combat-Senke
    // sind scene-langlebig und werden hier nicht besessen.
  }
}
