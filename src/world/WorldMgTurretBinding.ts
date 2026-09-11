import { MgAttritionRuntime, type MgOwner, type MgTarget } from '../systems/MgAttritionRuntime';
import { isSameCombatScope, combatTargetInstanceKey, type CombatSource, type CombatTargetRef } from '../combat/CombatScope';
import type { CombatDamageMutationOutcome } from '../combat/CombatMutation';
import type { WorldCombatCore } from '../combat/WorldCombatCore';
import type { EnemyManager } from '../entities/EnemyManager';
import type { BaseManager } from '../entities/BaseManager';
import type { WorldObjectMutationRuntime } from './WorldObjectMutationRuntime';

interface Rect { left: number; top: number; right: number; bottom: number }
interface WorldMgTarget extends MgTarget { readonly rectangles?: readonly Rect[] }
export interface WorldMgTurretOptions {
  readonly combat: WorldCombatCore;
  readonly getEnemies: () => EnemyManager | null;
  readonly bases: BaseManager | null;
  readonly getMutation: () => WorldObjectMutationRuntime | null;
  readonly owners: () => readonly MgOwner[];
}

/** Connects personal projectile provenance and committed damage to the single MG authority. */
export class WorldMgTurretBinding {
  readonly runtime: MgAttritionRuntime;
  private readonly unsubscribeEnemy: () => void;
  private unsubscribeWorld: (() => void) | null = null;
  private mutation: WorldObjectMutationRuntime | null = null;
  private ownerSignature = '';
  private readonly geometry = new Map<string, WorldMgTarget>();
  private readonly baseGeometry = new Map<string, WorldMgTarget>();
  private baseGeometryGeneration = -1;
  private readonly eligibleOwners = new Set<string>();
  private damageTime: number | null = null;
  private destroyed = false;

  constructor(private readonly options: WorldMgTurretOptions) {
    this.runtime = new MgAttritionRuntime({
      targets: () => this.targets(),
      canAffect: (ownerId, target) => target.ref.kind === 'base'
        ? options.bases?.getBase(String(target.ref.id))?.faction === 'hostile'
        : options.combat.canDamageTarget(ownerId, String(target.ref.id)),
      transferContact: (from, to, radius) => this.transferContact(from, to, radius),
      bleed: (target, amount, ownerId, at) => this.bleed(target, amount, ownerId, at),
    });
    this.unsubscribeEnemy = options.combat.observeEnemyDamageCommitted((outcome, x, y, now) => {
      this.committed(outcome, { x, y }, this.damageTime ?? now);
    });
    options.combat.setProjectileTargetMultiplier((source, target, now) => this.multiplier(source, target, now));
  }

  advance(now: number): void {
    if (this.destroyed) return;
    const mutation = this.options.getMutation();
    if (mutation !== this.mutation) {
      this.unsubscribeWorld?.(); this.mutation = mutation;
      this.unsubscribeWorld = mutation?.observeDamageCommitted((outcome, position) => {
        if (outcome.target.kind === 'base') this.committed(outcome, position, this.damageTime ?? this.options.combat.getHostTime());
      }) ?? null;
    }
    const owners = this.options.owners();
    const signature = JSON.stringify(owners);
    if (signature !== this.ownerSignature) {
      this.runtime.setOwners(owners, now);
      this.ownerSignature = signature;
    } else this.runtime.advance(now);
    this.eligibleOwners.clear();
    for (const owner of owners) this.eligibleOwners.add(owner.id);
  }

  multiplier(source: CombatSource, target: CombatTargetRef, now: number): number {
    return this.isPersonalHit(source)
      ? 1 + this.runtime.getPercent(source.personalMgOwnerId!, String(source.actor!.id), target, now) / 100 : 1;
  }

  score(ownerId: string, turretId: string, kind: 'player' | 'enemy' | 'base', id: string, now: number): number {
    const target = kind === 'enemy' ? this.options.getEnemies()?.getCombatTargetRef(id)
      : kind === 'base' ? this.options.getMutation()?.resolveTarget('base', id) : null;
    return target ? this.runtime.getPercent(ownerId, turretId, target, now) : 0;
  }

  clear(): void {
    this.runtime.clear(); this.ownerSignature = ''; this.geometry.clear(); this.eligibleOwners.clear();
    this.baseGeometry.clear(); this.baseGeometryGeneration = -1;
  }
  destroy(): void {
    this.destroyed = true;
    this.unsubscribeEnemy(); this.unsubscribeWorld?.();
    this.options.combat.setProjectileTargetMultiplier(null);
    this.clear();
  }

  private isPersonalHit(source: CombatSource): boolean {
    return !!source.personalMgOwnerId && this.eligibleOwners.has(source.personalMgOwnerId)
      && !!source.personalMgScope && isSameCombatScope(source.personalMgScope, this.options.combat.getCombatScope())
      && source.actor?.kind === 'turret' && source.authoredSourceId === 'TURRET_MG'
      && source.origin === 'direct' && source.correlation?.projectileId !== undefined
      && source.attribution.id === source.personalMgOwnerId && source.allegiance.ownerId === source.personalMgOwnerId
      && !source.lineage?.reflected;
  }

  private committed(outcome: CombatDamageMutationOutcome, position: { x: number; y: number }, now: number): void {
    if (this.destroyed || outcome.kind !== 'damage-applied' || outcome.actualDamage <= 0) return;
    const key = combatTargetInstanceKey(outcome.target);
    const cached = this.geometry.get(key);
    const target: MgTarget = cached?.rectangles ? cached : { ref: outcome.target, ...position };
    if (this.isPersonalHit(outcome.source)) this.runtime.hit(outcome.source.personalMgOwnerId!, String(outcome.source.actor!.id), target, now);
    if (outcome.transition.kind === 'dead' || outcome.transition.kind === 'destroyed') {
      this.runtime.death(target, now); this.geometry.delete(key);
    }
  }

  private targets(): WorldMgTarget[] {
    const targets: WorldMgTarget[] = [];
    const enemies = this.options.getEnemies();
    for (const enemy of enemies?.getHostileEnemies() ?? []) {
      if (enemy.getHp() <= 0 || !enemy.sprite.active) continue;
      const ref = enemies!.getCombatTargetRef(enemy.id);
      if (ref) targets.push({ ref, x: enemy.sprite.x, y: enemy.sprite.y });
    }
    const baseGeneration = this.options.bases?.getObstacleGeneration() ?? 0;
    if (baseGeneration !== this.baseGeometryGeneration) { this.baseGeometry.clear(); this.baseGeometryGeneration = baseGeneration; }
    for (const base of this.options.bases?.getBases() ?? []) {
      if (base.isInert() || base.faction !== 'hostile' || base.getHp() <= 0) continue;
      const ref = this.options.getMutation()?.resolveTarget('base', base.id);
      if (!ref) continue;
      const key = combatTargetInstanceKey(ref), cached = this.baseGeometry.get(key);
      if (cached) { targets.push(cached); continue; }
      const rectangles = base.getCellBodies().map(body => {
        const b = body.getBounds(); return { left: b.left, top: b.top, right: b.right, bottom: b.bottom };
      });
      if (!rectangles.length) continue;
      const target = { ref, rectangles,
        x: (Math.min(...rectangles.map(b => b.left)) + Math.max(...rectangles.map(b => b.right))) / 2,
        y: (Math.min(...rectangles.map(b => b.top)) + Math.max(...rectangles.map(b => b.bottom))) / 2 };
      this.baseGeometry.set(key, target); targets.push(target);
    }
    this.geometry.clear();
    for (const target of targets) this.geometry.set(combatTargetInstanceKey(target.ref), target);
    return targets;
  }

  private transferContact(from: MgTarget, to: MgTarget, radius: number): { x: number; y: number; fromX: number; fromY: number } | null {
    const destination = this.geometry.get(combatTargetInstanceKey(to.ref));
    // The terminal receipt retains source geometry even after its HP owner removes the bodies.
    const source = from as WorldMgTarget;
    const pointRect = (p: MgTarget): Rect => ({ left: p.x, right: p.x, top: p.y, bottom: p.y });
    const segments = (source.rectangles ?? [pointRect(from)]).flatMap(a =>
      (destination?.rectangles ?? [pointRect(to)]).map(b => nearestContourSegment(a, b)));
    segments.sort((a, b) => a.distance - b.distance || a.start.x - b.start.x || a.start.y - b.start.y);
    for (const segment of segments) {
      if (segment.distance > radius) continue;
      const start = exitFootprint(segment.start, segment.end, source.rectangles ?? []);
      const end = exitFootprint(segment.end, segment.start, destination?.rectangles ?? []);
      if (this.options.combat.hasLineOfSight(start.x, start.y, end.x, end.y)) {
        return { ...segment.end, fromX: segment.start.x, fromY: segment.start.y };
      }
    }
    return null;
  }

  private bleed(target: CombatTargetRef, amount: number, ownerId: string, at: number): void {
    if (!this.eligibleOwners.has(ownerId)) return;
    const source: CombatSource = { gameplaySource: { kind: 'player', id: ownerId }, attribution: { kind: 'player', id: ownerId },
      allegiance: { kind: 'player', ownerId }, authoredSourceId: 'mg_bleed', sourceSlot: 'utility', origin: 'ground' };
    this.damageTime = at;
    try {
      if (target.kind === 'enemy') {
        this.options.combat.applyDamage(String(target.id), amount, false, ownerId, 'mg_bleed', undefined, {
          target, damageKind: 'ground', sourceSlot: 'utility', allowCritical: false, skipLifeLeech: true, suppressHitEffect: true, source,
          basis: { kind: 'source-resolved', amount, sourceFactors: [{ kind: 'outgoing-modifier', multiplier: 1, resolvedAt: 'execution' }] },
        });
      } else if (target.kind === 'base') {
        this.options.combat.applyBaseStatusDamage(String(target.id), amount, source, at);
      }
    } finally { this.damageTime = null; }
  }
}

function nearestContourSegment(a: Rect, b: Rect) {
  const axis = (a0: number, a1: number, b0: number, b1: number): [number, number] => {
    if (a1 < b0) return [a1, b0];
    if (b1 < a0) return [a0, b1];
    const common = (Math.max(a0, b0) + Math.min(a1, b1)) / 2;
    return [common, common];
  };
  const [x1, x2] = axis(a.left, a.right, b.left, b.right), [y1, y2] = axis(a.top, a.bottom, b.top, b.bottom);
  return { start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, distance: Math.hypot(x2 - x1, y2 - y1) };
}

/** Move a source inside its own base to the outer surface without ignoring other bases. */
export function exitFootprint(from: { x: number; y: number }, to: { x: number; y: number }, rectangles: readonly Rect[]): { x: number; y: number } {
  const dx = to.x - from.x, dy = to.y - from.y;
  let exit = 0;
  for (const b of rectangles) {
    let min = 0, max = 1;
    for (const [start, delta, lower, upper] of [[from.x, dx, b.left, b.right], [from.y, dy, b.top, b.bottom]]) {
      if (Math.abs(delta) < 1e-9) { if (start < lower || start > upper) { max = -1; break; } }
      else { const a = (lower - start) / delta, z = (upper - start) / delta; min = Math.max(min, Math.min(a, z)); max = Math.min(max, Math.max(a, z)); }
    }
    if (min <= max && max >= 0) exit = Math.max(exit, max);
  }
  if (!exit) return from;
  const t = Math.min(1, exit + 1 / Math.max(1, Math.hypot(dx, dy)));
  return { x: from.x + dx * t, y: from.y + dy * t };
}
