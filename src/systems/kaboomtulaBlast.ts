import { isOffensiveConstruction } from './offensiveConstruction';
import type { CoopDefenseEnemyKaboomtulaConfig } from '../config/coopDefenseEnemies';
import type { BaseManager } from '../entities/BaseManager';
import type { EnemyDeathInfo } from '../entities/EnemyManager';
import type { EnemyEntity } from '../entities/EnemyEntity';
import type { PlayerManager } from '../entities/PlayerManager';
import type { CombatActorStatePort, CombatDamageEffectPort, CombatGeometryPort } from '../combat/CombatCapabilities';
import type { CombatSource } from '../combat/CombatScope';
import type { DecoySystem } from './DecoySystem';
import type { EnemyAiTargetCatalog } from './EnemyAiTargetCatalog';
import type { FireChunkBurstPort } from './FlamethrowerUpgradeSystem';
import type { KaboomtulaContact } from './CoopDefenseKaboomtulaSystem';
import type { PlacementSystem } from './PlacementSystem';

export const KABOOMTULA_BLAST_SOURCE_ID = 'enemy.kaboomtula.blast';
export const KABOOMTULA_POP_SOURCE_ID = 'enemy.kaboomtula.pop';

export interface KaboomtulaBlastHooks {
  readonly playExplosion: (x: number, y: number, radius: number, style: 'timebomb' | 'timebomb_pop') => void;
  readonly applyRadialImpulse: (x: number, y: number, radius: number, force: number, ownerId: string) => void;
  readonly damageConstruction: (id: number, damage: number, attackerId: string) => void;
  readonly removeWithoutKill: (enemyId: string) => void;
  readonly onSelfDetonated?: (enemyId: string) => void;
}

export interface KaboomtulaBlastDeps {
  readonly playerManager: PlayerManager;
  readonly baseManager: BaseManager | null;
  readonly placementSystem: PlacementSystem;
  readonly combat: CombatActorStatePort & CombatDamageEffectPort & CombatGeometryPort;
  readonly catalog: EnemyAiTargetCatalog | null;
  readonly decoySystem: DecoySystem | null;
  readonly fireChunks: FireChunkBurstPort | null;
  readonly hooks: KaboomtulaBlastHooks;
}

/** Linear falloff to 20 % at the edge of the radius. */
function falloff(maxDamage: number, distance: number, radius: number): number {
  return Math.round(maxDamage * (0.2 + 0.8 * (1 - Math.min(1, distance / radius))));
}

/**
 * Damage application of the Kabummtula. The touched target takes the full blast damage, everything
 * else in the radius a distance falloff: players (a player inside a structure is hit once at the
 * structure surface), decoys, offensive constructions and watchtowers, represented friendly
 * outposts and bases, plus the base a kamikaze spider detonated against.
 */
export class KaboomtulaBlast {
  constructor(private readonly deps: KaboomtulaBlastDeps) {}

  detonate(enemy: EnemyEntity, config: CoopDefenseEnemyKaboomtulaConfig, contact: KaboomtulaContact, now: number): void {
    const x = enemy.sprite.x, y = enemy.sprite.y, blast = config.blast, id = enemy.id;
    const hitStructures = this.damagePlayers(id, x, y, blast.radiusPx, blast.damage, KABOOMTULA_BLAST_SOURCE_ID,
      contact.ref.kind === 'player' ? contact.ref.id : null);
    this.damageDecoys(id, x, y, blast.radiusPx, blast.damage, KABOOMTULA_BLAST_SOURCE_ID,
      contact.ref.kind === 'decoy' ? contact.ref.id : null);
    this.damageConstructions(id, x, y, blast.radiusPx, blast.damage, hitStructures);
    this.damageArmedOutposts(id, x, y, blast.radiusPx, blast.damage, contact.ref.kind === 'base' ? contact.ref.id : null);
    if (contact.ref.kind === 'base' && blast.baseDamage > 0) this.deps.combat.applyBaseDamage(contact.ref.id, blast.baseDamage, id);
    this.deps.hooks.applyRadialImpulse(x, y, blast.radiusPx, blast.knockback, id);
    this.deps.hooks.playExplosion(x, y, blast.radiusPx, 'timebomb');
    if (blast.fireChunks) this.deps.fireChunks?.hostCreateFireChunkBurst(id, x, y, blast.fireChunks, `kaboomtula:${id}:${Math.round(now)}`, now);
    // Bis hier bleibt der Gegner registriert, damit Schadensregeln seine feindliche Fraktion
    // erkennen. Erst nach allen synchronen Explosionswirkungen folgt die belohnungsfreie Entfernung.
    this.deps.hooks.removeWithoutKill(id);
    this.deps.hooks.onSelfDetonated?.(id);
  }

  /** Small pop of a killed spider: players and decoys only. */
  killedPop(death: EnemyDeathInfo, config: CoopDefenseEnemyKaboomtulaConfig): void {
    const { radiusPx, damage } = config.killedPop;
    this.damagePlayers(death.id, death.x, death.y, radiusPx, damage, KABOOMTULA_POP_SOURCE_ID, null);
    this.damageDecoys(death.id, death.x, death.y, radiusPx, damage, KABOOMTULA_POP_SOURCE_ID, null);
    this.deps.hooks.playExplosion(death.x, death.y, radiusPx, 'timebomb_pop');
  }

  private damagePlayers(attackerId: string, x: number, y: number, radius: number, maxDamage: number, sourceId: string,
    touchedPlayerId: string | null): Set<number> {
    const hitStructures = new Set<number>();
    if (maxDamage <= 0) return hitStructures;
    const combat = this.deps.combat, placement = this.deps.placementSystem;
    for (const player of this.deps.playerManager.getAllPlayers()) {
      if (!player.active || !combat.isAlive(player.id) || combat.isBurrowed(player.id)) continue;
      const structureId = combat.getStructureOccupancyId?.(player.id);
      if (structureId !== undefined && hitStructures.has(structureId)) continue;
      const structure = structureId === undefined ? null : placement.getRuntimeRock(structureId);
      const point = structure ? placement.getRuntimeRockSurfacePoint(structure, x, y) : player;
      const distance = Math.hypot(point.x - x, point.y - y);
      if (player.id !== touchedPlayerId && distance > radius) continue;
      const damage = player.id === touchedPlayerId ? Math.round(maxDamage) : falloff(maxDamage, distance, radius);
      if (structureId !== undefined) hitStructures.add(structureId);
      combat.applyDamage(player.id, damage, false, attackerId, sourceId, { sourceX: x, sourceY: y }, {
        damageKind: 'explosion', source: this.explosionSource(attackerId, sourceId),
      });
    }
    return hitStructures;
  }

  private damageDecoys(attackerId: string, x: number, y: number, radius: number, maxDamage: number, sourceId: string,
    touchedDecoyId: string | null): void {
    const decoys = this.deps.decoySystem;
    if (!decoys || maxDamage <= 0) return;
    for (const decoy of decoys.getHostTargets()) {
      const touched = touchedDecoyId !== null && String(decoy.id) === touchedDecoyId;
      const distance = Math.hypot(decoy.x - x, decoy.y - y);
      if (!touched && distance > radius) continue;
      decoys.applyDamage(decoy.id, touched ? Math.round(maxDamage) : falloff(maxDamage, distance, radius), attackerId, sourceId,
        { sourceX: x, sourceY: y }, this.explosionSource(attackerId, sourceId));
    }
  }

  private damageConstructions(attackerId: string, x: number, y: number, radius: number, maxDamage: number, excluded: Set<number>): void {
    const placement = this.deps.placementSystem;
    for (const construction of placement.getAllRuntimeRocks()) {
      if (excluded.has(construction.id)) continue;
      if (construction.hp <= 0 || (!isOffensiveConstruction(construction) && construction.kind !== 'watchtower')) continue;
      const world = construction.kind === 'watchtower'
        ? placement.getRuntimeRockSurfacePoint(construction, x, y)
        : placement.getWorldPointForCell(construction.gridX, construction.gridY);
      const distance = Math.hypot(world.x - x, world.y - y);
      if (distance > radius) continue;
      this.deps.hooks.damageConstruction(construction.id, falloff(maxDamage, distance, radius), attackerId);
    }
  }

  /** Represented bases (players inside) and armed outposts take the falloff; the kamikaze base is booked separately. */
  private damageArmedOutposts(attackerId: string, x: number, y: number, radius: number, maxDamage: number, kamikazeBaseId: string | null): void {
    for (const base of this.deps.baseManager?.getBasesByFaction('friendly') ?? []) {
      if (base.id === kamikazeBaseId) continue;
      const represented = this.deps.catalog?.resolve({ kind: base.role === 'outpost' ? 'armed-outpost' : 'armed-base', id: base.id })
        ?.representedPlayerIds?.length;
      if ((base.isInert?.() ?? false) || base.getHp() <= 0
        || (!represented && (base.role !== 'outpost' || base.getTurrets().length === 0))) continue;
      const surface = base.getNearestSurfacePoint(x, y);
      if (!surface || surface.distance > radius) continue;
      if (represented && !this.deps.combat.hasClearLineOfFire(x, y, surface.x, surface.y)) continue;
      // Auch Gegner-Spezialschaden laeuft durch den zentralen Zielstatuspfad, damit Matrixschutz
      // und Verwundbarkeit auf Basen fuer jede Schadensquelle gleich gelten.
      this.deps.combat.applyBaseDamage(base.id, falloff(maxDamage, surface.distance, radius), attackerId);
    }
  }

  private explosionSource(enemyId: string, sourceId: string): CombatSource {
    return {
      gameplaySource: { kind: 'enemy', id: enemyId }, actor: { kind: 'enemy', id: enemyId },
      attribution: { kind: 'enemy', id: enemyId }, allegiance: { ownerId: enemyId, factionId: 'hostile' },
      authoredSourceId: sourceId, origin: 'explosion',
    };
  }
}
