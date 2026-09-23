import { CELL_SIZE } from '../config';
import type { PlayerManager } from '../entities/PlayerManager';
import type { EnemyManager } from '../entities/EnemyManager';
import type { BaseManager } from '../entities/BaseManager';
import type { PlacementSystem } from '../systems/PlacementSystem';
import type { DecoySystem } from '../systems/DecoySystem';
import type { WorldMetrics } from './WorldMetrics';
import type { WorldCombatCore } from '../combat/WorldCombatCore';
import { plasmaBurnerTargetEffect, type PlasmaBurnerTarget, type PlasmaBurnerTargetCatalogPort } from '../combat/plasmaBurner/PlasmaBurnerTargetPolicy';

/** World enumeration only. Eligibility belongs to the shared pure policy; mutation to Combat. */
export class PlasmaBurnerTargetCatalog implements PlasmaBurnerTargetCatalogPort {
  constructor(private readonly ports: {
    players: PlayerManager; enemies(): EnemyManager | null; bases: BaseManager | null;
    placement: PlacementSystem; decoys: DecoySystem; metrics: WorldMetrics;
    combat: Pick<WorldCombatCore, 'isAlive' | 'isPlayerTargetable' | 'getHP' | 'getMaxHp' | 'canDamageTarget'
      | 'canSupportPlasmaBurnerTarget' | 'captureWorldDamageSource' | 'canDamageStructure'>;
  }) {}

  read(key: string, ownerId: string, fromX: number, fromY: number): PlasmaBurnerTarget | null {
    const split = key.indexOf(':');
    const kind = key.slice(0, split) as PlasmaBurnerTarget['kind'];
    const id = key.slice(split + 1);
    const p = this.ports;
    const common = { key, kind, id, self: kind === 'player' && id === ownerId, automatic: true };
    if (kind === 'player') {
      const player = p.players.getPlayer(id);
      if (!player) return null;
      return { ...common, category: 'combatant', x: player.x, y: player.y,
        hp: p.combat.getHP(id), maxHp: p.combat.getMaxHp(id), alive: p.combat.isAlive(id) && p.combat.isPlayerTargetable(id),
        damageable: p.combat.canDamageTarget(ownerId, id), supportable: p.combat.canSupportPlasmaBurnerTarget(ownerId, id) };
    }
    if (kind === 'enemy') {
      const enemy = p.enemies()?.getEnemy(id);
      return enemy ? { ...common, category: 'combatant', x: enemy.sprite.x, y: enemy.sprite.y,
        hp: enemy.getHp(), maxHp: enemy.getMaxHp(), alive: enemy.sprite.active && enemy.getHp() > 0,
        damageable: p.combat.canDamageTarget(ownerId, id), supportable: false } : null;
    }
    if (kind === 'decoy') {
      const decoy = p.decoys.getHostTarget(Number(id));
      return decoy ? { ...common, category: 'combatant', x: decoy.x, y: decoy.y, hp: decoy.hp, maxHp: decoy.maxHp,
        alive: decoy.hp > 0, damageable: p.combat.canDamageTarget(ownerId, decoy.ownerId), supportable: false } : null;
    }
    const source = p.combat.captureWorldDamageSource(ownerId, 'PLASMA_BURNER');
    if (kind === 'base') {
      const base = p.bases?.getBase(id);
      const surface = base?.getNearestSurfacePoint(fromX, fromY);
      if (!base || !surface) return null;
      const damageable = p.combat.canDamageStructure(source, undefined, base.faction);
      return { ...common, category: 'structure', ...surface, hp: base.getHp(), maxHp: base.getMaxHp(),
        alive: base.getHp() > 0 && !base.isInert(), damageable, supportable: !damageable };
    }
    const rock = p.placement.getRuntimeRock(Number(id));
    if (!rock) return null;
    const bounds = { left: p.metrics.offsetX + rock.gridX * CELL_SIZE, top: p.metrics.offsetY + rock.gridY * CELL_SIZE };
    const damageable = !rock.indestructible && p.combat.canDamageStructure(source, rock.ownerId);
    const integrity = p.placement.readIntegrity(rock.id);
    return { ...common, kind: 'construction', key: `construction:${id}`, category: 'structure',
      x: Math.max(bounds.left, Math.min(bounds.left + CELL_SIZE, fromX)),
      y: Math.max(bounds.top, Math.min(bounds.top + CELL_SIZE, fromY)),
      hp: integrity?.integrity ?? 0, maxHp: integrity?.maxIntegrity ?? 0, alive: !!integrity && !integrity.destroyed,
      damageable, supportable: !p.combat.canDamageStructure(source, rock.ownerId),
      automatic: rock.kind !== 'pedestal' && rock.kind !== 'tunnel' };
  }

  query(ownerId: string, x: number, y: number, radius: number): PlasmaBurnerTarget[] {
    const p = this.ports;
    const results: PlasmaBurnerTarget[] = [];
    const add = (key: string) => {
      const target = this.read(key, ownerId, x, y);
      if (target && Math.hypot(target.x - x, target.y - y) <= radius && plasmaBurnerTargetEffect(target, 'automatic')) results.push(target);
    };
    const near = (tx: number, ty: number) => (tx - x) ** 2 + (ty - y) ** 2 <= radius * radius;
    for (const t of p.players.getAllPlayers()) if (near(t.x, t.y)) add('player:' + t.id);
    p.enemies()?.forEachEnemy(t => { if (near(t.sprite.x, t.sprite.y)) add('enemy:' + t.id); });
    for (const t of p.decoys.getHostTargets()) if (near(t.x, t.y)) add('decoy:' + t.id);
    for (let gx = Math.floor((x - radius - p.metrics.offsetX) / CELL_SIZE); gx <= Math.floor((x + radius - p.metrics.offsetX) / CELL_SIZE); gx++)
      for (let gy = Math.floor((y - radius - p.metrics.offsetY) / CELL_SIZE); gy <= Math.floor((y + radius - p.metrics.offsetY) / CELL_SIZE); gy++) {
        const rock = p.placement.getRuntimeRockAt(gx, gy); if (rock) add('construction:' + rock.id);
      }
    for (const base of p.bases?.getBases() ?? []) add('base:' + base.id);
    return results;
  }
}
