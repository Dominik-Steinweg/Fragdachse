import type { WorldScopedBinding } from './WorldRuntime';
import type {
  CombatImmediateAttackPort,
  CombatLegacyHitscanAttackPort,
  CombatLegacyMeleeAttackPort,
  CombatSafeMuzzlePort,
} from '../combat/CombatCapabilities';
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
  Partial<CombatLegacyHitscanAttackPort>
  &
  Partial<CombatLegacyMeleeAttackPort>
  & Partial<CombatSafeMuzzlePort>
  & Partial<CombatImmediateAttackPort>;

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
        const normalizedRequest = { ...request, startX: resolvedStart.x, startY: resolvedStart.y, range: resolvedRange };
        if (combatSystem.resolveImmediateAttack) {
          return combatSystem.resolveImmediateAttack({
            kind: 'hitscan',
            payload: normalizedRequest,
            origin: { x: resolvedStart.x, y: resolvedStart.y },
            aim: { x: Math.cos(request.angle), y: Math.sin(request.angle) },
            range: resolvedRange,
          }).accepted;
        }
        // Compatibility for isolated pre-P8 test doubles. The composed CombatSystem always
        // exposes the normalized port above; no production binding uses this fallback.
        if (!combatSystem.resolveHitscanShot) return false;
        return combatSystem.resolveHitscanShot(
          request.shooterId, resolvedStart.x, resolvedStart.y, request.angle, resolvedRange,
          request.damage, request.traceThickness, request.color, request.adrenalinGain,
          request.sourceId, request.visualPreset, request.shotAudioKey, request.sourceSlot,
          request.shotId, request.detonator, request.rockDamageMult, request.trainDamageMult,
          request.chainLightning, request.burnOnHit, request.supportEffect,
          request.visualMuzzleOrigin, request.baseDamageMult,
        );
      },
      resolveMelee: (request) => {
        if (combatSystem.resolveImmediateAttack) {
          return combatSystem.resolveImmediateAttack({
            kind: 'melee',
            payload: request,
            origin: { x: request.x, y: request.y },
            aim: { x: Math.cos(request.angle), y: Math.sin(request.angle) },
            range: request.range,
          }).accepted;
        }
        // Compatibility for isolated pre-P8 test doubles; see the Hitscan fallback above.
        if (!combatSystem.resolveMeleeSwing) return false;
        return combatSystem.resolveMeleeSwing(
          request.shooterId, request.x, request.y, request.angle, request.range,
          request.arcDegrees, request.damage, request.adrenalinGain, request.sourceId,
          request.color, request.sourceSlot, request.rockDamageMult, request.trainDamageMult,
          request.visualPreset, request.shotAudioKey, request.burnOnHit, undefined,
          request.hitHeal, request.hitAdrenaline, request.bloodEffectMultiplier,
          request.damageTargets, request.baseDamageMult,
        ) ?? false;
      },
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
