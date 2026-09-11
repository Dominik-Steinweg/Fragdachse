import type { WorldScopedBinding } from './WorldRuntime';
import type {
  CombatImmediateAttackPort,
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
  CombatSafeMuzzlePort & CombatImmediateAttackPort;

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
        const resolvedStart = combatSystem.resolveSafeHitscanStart(
          shooterX, shooterY, request.startX, request.startY,
          { sourceCarrierBaseId: request.sourceCarrierBaseId, purpose: request.supportEffect ? 'support' : 'directFire' },
        );
        const resolvedRange = getHitscanRequestRange(request, resolvedStart.x, resolvedStart.y, request.angle);
        const normalizedRequest = { ...request, startX: resolvedStart.x, startY: resolvedStart.y, range: resolvedRange };
        return combatSystem.resolveImmediateAttack({
          kind: 'hitscan',
          payload: normalizedRequest,
          origin: { x: resolvedStart.x, y: resolvedStart.y },
          aim: { x: Math.cos(request.angle), y: Math.sin(request.angle) },
          range: resolvedRange,
        }).accepted;
      },
      resolveMelee: (request) => {
        return combatSystem.resolveImmediateAttack({
          kind: 'melee',
          payload: request,
          origin: { x: request.x, y: request.y },
          aim: { x: Math.cos(request.angle), y: Math.sin(request.angle) },
          range: request.range,
        }).accepted;
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
