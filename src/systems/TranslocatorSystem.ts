import type { PlayerManager } from '../entities/PlayerManager';
import type { CombatActorStatePort, CombatDamageEffectPort } from '../combat/CombatCapabilities';
import type { TrainManager } from '../train/TrainManager';
import type { TranslocatorUtilityConfig } from '../loadout/LoadoutConfig';
import type { LoadoutUseParams } from '../types';
import type { TranslocatorProjectilePort } from '../projectile/ProjectileExternalInteractionPort';
import type { TranslocatorUseState } from '../loadout/TranslocatorUseState';
import { findPortalCrossing, gatePortalExit, portalEndpointKey, releasePortalGates,
  type PortalGates, type PortalPair, type PortalPoint, type PortalQueryPort } from './PortalTraversal';

export interface TranslocatorNetworkPort {
  readonly getPlayerColor: (playerId: string) => number | undefined;
  readonly broadcastTranslocatorFlash: (x: number, y: number, color: number, phase: 'start' | 'end', ownerId: string) => void;
  readonly broadcastExplosionEffect: (x: number, y: number, radius: number) => void;
  readonly publishTranslocatorUseState?: (playerId: string, state: TranslocatorUseState | null) => void;
  readonly broadcastPortalCollapse?: (pair: PortalPair, radius: number) => void;
}
export interface TranslocatorActor extends PortalPoint {
  readonly id: string;
  readonly kind: 'player' | 'enemy';
  readonly radius: number;
  readonly alive: boolean;
  readonly surface: boolean;
  readonly revision: number;
}
export interface TranslocatorWorldPort {
  readonly getActors: () => readonly TranslocatorActor[];
  readonly canOccupy: (actor: TranslocatorActor, x: number, y: number) => boolean;
  readonly resolveExitMovement?: (actor: TranslocatorActor, from: PortalPoint, to: PortalPoint) => PortalPoint;
  readonly transferActor: (actor: TranslocatorActor, x: number, y: number) => void;
  readonly isFriendly: (ownerId: string, actorId: string) => boolean;
  readonly canDamage: (ownerId: string, actorId: string) => boolean;
  readonly collapseEnemy: (actor: TranslocatorActor, center: PortalPoint, config: TranslocatorUtilityConfig, ownerId: string, now: number) => void;
}
export type TranslocatorUseOutcome = 'thrown' | 'teleported' | 'opened' | 'closed' | 'blocked';
interface ActiveUse { state: TranslocatorUseState; readonly config: TranslocatorUtilityConfig }
interface PhaseBuff { readonly value: number; readonly expiresAt: number }

/** Sole writer of a player's complete translocator lifetime and acquired phase buffs. */
export class TranslocatorSystem implements PortalQueryPort {
  private readonly uses = new Map<string, ActiveUse>();
  private readonly pairs = new Map<string, PortalPair>();
  private pairView: readonly PortalPair[] = [];
  private readonly gates = new Map<string, PortalGates>();
  private readonly positions = new Map<string, TranslocatorActor>();
  private readonly moveBuffs = new Map<string, PhaseBuff>();
  private readonly regenBuffs = new Map<string, PhaseBuff>();
  private world: TranslocatorWorldPort | null = null;
  private onUseCb: ((playerId: string) => void) | null = null;
  private positionResetCb: ((playerId: string, x: number, y: number) => void) | null = null;
  constructor(private readonly playerManager: PlayerManager, private readonly projectilePort: TranslocatorProjectilePort,
    private readonly combatSystem: CombatActorStatePort & CombatDamageEffectPort,
    private readonly network: TranslocatorNetworkPort, private trainManager?: TrainManager | null) {}

  bindWorld(world: TranslocatorWorldPort | null): void { this.world = world; }
  setTrainManager(train: TrainManager | null): void { this.trainManager = train; }
  setUseCallback(cb: ((id: string) => void) | null): void { this.onUseCb = cb; }
  setPositionResetCallback(cb: ((id: string, x: number, y: number) => void) | null): void { this.positionResetCb = cb; }
  getUseState(id: string): TranslocatorUseState | null { return this.uses.get(id)?.state ?? null; }
  getActivePuckId(id: string): number | undefined {
    const state = this.getUseState(id); return state?.phase === 'puck' ? state.projectileId : undefined;
  }
  hasFollowup(id: string): boolean {
    const state = this.getUseState(id); return state?.phase === 'puck' || state?.phase === 'portals';
  }
  getPortalPairs(): readonly PortalPair[] { return this.pairView; }
  isPortalFriendly(ownerId: string, attackerId: string): boolean { return this.world?.isFriendly(ownerId, attackerId) ?? false; }
  getMoveSpeedBonus(id: string, now: number): number { const b = this.moveBuffs.get(id); return b && b.expiresAt > now ? b.value : 0; }
  getHpRegen(id: string, now: number): number { const b = this.regenBuffs.get(id); return b && b.expiresAt > now ? b.value : 0; }

  handleUse(id: string, angle: number, _targetX: number, _targetY: number, now: number,
    params: LoadoutUseParams | undefined, config: TranslocatorUtilityConfig): TranslocatorUseOutcome {
    if (!this.world || !this.combatSystem.isAlive(id)) return 'blocked';
    this.updateUse(id, now);
    const use = this.uses.get(id);
    if (use?.state.phase === 'cooldown') return 'blocked';
    if (use?.state.phase === 'portals') { this.finish(id, use, now, true); return 'closed'; }
    if (use?.state.phase === 'puck') return this.teleport(id, use, now);
    const player = this.playerManager.getPlayer(id);
    if (!player) return 'blocked';
    const fraction = Math.max(0, Math.min(1, params?.utilityChargeFraction ?? 1));
    const speed = (config.projectileSpeed ?? 600) * (0.3 + fraction * 0.7);
    const projectileId = this.projectilePort.spawnPuck({ x: player.x + Math.cos(angle) * 16,
      y: player.y + Math.sin(angle) * 16, angle, ownerId: id, speed, size: config.projectileSize ?? 16,
      color: config.projectileColor ?? 0xa8b5b2, ownerColor: this.network.getPlayerColor(id),
      lifetimeMs: 9999999, maxBounces: config.maxBounces ?? 3, sourceId: config.id,
      frictionDelayMs: config.frictionDelayMs, airFrictionDecayPerSec: config.airFrictionDecayPerSec,
      bounceFrictionMultiplier: config.bounceFrictionMultiplier, stopSpeedThreshold: config.stopSpeedThreshold });
    if (projectileId < 0) return 'blocked';
    this.uses.set(id, { config: structuredClone(config), state: { phase: 'puck', utilityId: 'TRANSLOCATOR',
      useId: 'translocator:' + id + ':' + projectileId, projectileId, cooldownDurationMs: config.cooldown,
      temporaryUtilityInstanceId: params?.temporaryUtilityInstanceId } });
    this.onUseCb?.(id);
    this.publish(id);
    return 'thrown';
  }

  /** Follow-up identity survives depleted temporary stock and utility selection changes. */
  followup(id: string, useId: string, now: number): TranslocatorUseOutcome {
    const use = this.uses.get(id);
    if (!use || use.state.useId !== useId || !this.combatSystem.isAlive(id)) return 'blocked';
    this.updateUse(id, now);
    if (use.state.phase === 'portals') { this.finish(id, use, now, true); return 'closed'; }
    return use.state.phase === 'puck' ? this.teleport(id, use, now) : 'blocked';
  }

  private teleport(id: string, use: ActiveUse, now: number): TranslocatorUseOutcome {
    if (!this.world || use.state.phase !== 'puck') return 'blocked';
    const destination = this.projectilePort.getPuckPosition(use.state.projectileId);
    const actor = this.world.getActors().find(a => a.id === id);
    const cfg = use.config;
    if (!destination || !actor || !this.world.canOccupy(actor, destination.x, destination.y)
      || (cfg.portalEnabled > 0 && Math.hypot(destination.x - actor.x, destination.y - actor.y) < cfg.portalMinSeparation)) return 'blocked';
    if (!this.projectilePort.consumePuck(use.state.projectileId)) return 'blocked';
    const pair: PortalPair | null = cfg.portalEnabled > 0 ? { id: use.state.useId, ownerId: id,
      a: { ...destination }, b: { x: actor.x, y: actor.y }, radius: cfg.portalRadius,
      reentryDistance: cfg.portalReentryDistance, damageBonus: cfg.portalDamageBonus,
      createdAt: now, expiresAt: now + cfg.portalDurationMs } : null;
    if (pair) {
      use.state = { ...this.common(use.state), phase: 'portals', pair };
      this.pairs.set(pair.id, pair); this.refreshPairs();
      this.actorGates(id).set(portalEndpointKey(pair, 'a'), { center: pair.a, releaseDistance: pair.reentryDistance });
    } else use.state = { ...this.common(use.state), phase: 'cooldown', cooldownUntil: now + use.state.cooldownDurationMs };
    this.onUseCb?.(id);
    this.transfer(actor, destination.x, destination.y);
    this.applyBuffs(id, cfg, now);
    // Commit before damage: a synchronous death can close the pair exactly once.
    this.publish(id);
    for (const other of this.world.getActors()) {
      if (!other.alive || other.id === id || this.world.isFriendly(id, other.id)
        || !this.world.canDamage(id, other.id)) continue;
      if (Math.hypot(other.x - destination.x, other.y - destination.y) > cfg.telefragRadius + other.radius) continue;
      this.combatSystem.applyDamage(other.id, cfg.telefragDamage, false, id, 'environment.telefrag',
        { sourceX: destination.x, sourceY: destination.y },
        { sourceSlot: 'utility', basis: { kind: 'authored', amount: cfg.telefragDamage } });
    }
    this.checkTrainHazard(id, destination.x, destination.y, actor.radius);
    this.updateUse(id, now);
    if (pair && this.pairs.has(pair.id)) this.transferActors(now, true);
    return pair ? 'opened' : 'teleported';
  }

  update(now: number): void {
    for (const id of this.uses.keys()) this.updateUse(id, now);
    for (const buffs of [this.moveBuffs, this.regenBuffs]) for (const [id, buff] of buffs) {
      if (buff.expiresAt <= now || !this.combatSystem.isAlive(id)) buffs.delete(id);
    }
  }
  private updateUse(id: string, now: number): void {
    const use = this.uses.get(id); if (!use) return;
    const state = use.state;
    if (state.phase === 'cooldown') {
      if (state.cooldownUntil <= now) { this.uses.delete(id); this.publish(id); }
    } else if (!this.combatSystem.isAlive(id) || (state.phase === 'portals' && state.pair.expiresAt <= now)
      || (state.phase === 'puck' && !this.projectilePort.getPuckPosition(state.projectileId))) {
      this.finish(id, use, now, state.phase === 'portals');
    }
  }

  /** After physics, before any owner consumes traveled actor segments. */
  transferActors(now: number, opening = false): void {
    if (!this.world || !this.pairs.size) { this.positions.clear(); return; }
    const present = new Set<string>();
    for (const actor of this.world.getActors()) {
      present.add(actor.id);
      const previous = this.positions.get(actor.id);
      let from: PortalPoint = !opening && previous?.revision === actor.revision ? previous : actor;
      let to: PortalPoint = actor;
      const gates = this.actorGates(actor.id);
      releasePortalGates(gates, from);
      const visited = new Set<string>();
      let transfers = 0;
      if (actor.alive && actor.surface) {
        for (;;) {
          const hit = findPortalCrossing(this.pairView, from, to, { gates, excludedEndpoints: visited });
          if (!hit) break;
          visited.add(hit.sourceKey);
          if (!this.world.canOccupy(actor, hit.exit.x, hit.exit.y)) continue;
          const rest = { x: to.x - hit.entry.x, y: to.y - hit.entry.y };
          gatePortalExit(gates, hit);
          from = hit.exit;
          const desired = { x: hit.exit.x + rest.x, y: hit.exit.y + rest.y };
          to = this.world.resolveExitMovement?.(actor, hit.exit, desired)
            ?? (this.world.canOccupy(actor, desired.x, desired.y) ? desired : hit.exit);
          this.transfer({ ...actor, x: hit.entry.x, y: hit.entry.y }, to.x, to.y);
          transfers++;
          const use = this.uses.get(hit.pair.ownerId);
          if (actor.kind === 'player' && use && this.world.isFriendly(hit.pair.ownerId, actor.id)) this.applyBuffs(actor.id, use.config, now);
          if (actor.kind === 'player') this.checkTrainHazard(actor.id, to.x, to.y, actor.radius);
        }
      }
      this.positions.set(actor.id, { ...actor, x: to.x, y: to.y, revision: actor.revision + transfers });
    }
    for (const id of this.positions.keys()) if (!present.has(id)) { this.positions.delete(id); this.gates.delete(id); }
  }

  private transfer(actor: TranslocatorActor, x: number, y: number): void {
    this.network.broadcastTranslocatorFlash(actor.x, actor.y, 0x55bbff, 'start', actor.id);
    this.world!.transferActor(actor, x, y);
    if (actor.kind === 'player') this.positionResetCb?.(actor.id, x, y);
    this.network.broadcastTranslocatorFlash(x, y, 0xff9b45, 'end', actor.id);
  }
  private applyBuffs(id: string, cfg: TranslocatorUtilityConfig, now: number): void {
    if (cfg.phaseMoveSpeedBonus > 0) this.moveBuffs.set(id, { value: cfg.phaseMoveSpeedBonus, expiresAt: now + cfg.phaseMoveDurationMs });
    if (cfg.phaseHpRegenPerSecond > 0) this.regenBuffs.set(id, { value: cfg.phaseHpRegenPerSecond, expiresAt: now + cfg.phaseRegenDurationMs });
  }
  private finish(id: string, use: ActiveUse, now: number, collapse: boolean): void {
    const state = use.state;
    if (state.phase === 'cooldown') return;
    if (state.phase === 'puck') this.projectilePort.consumePuck(state.projectileId);
    if (state.phase === 'portals') {
      this.pairs.delete(state.pair.id); this.refreshPairs();
      for (const gates of this.gates.values()) { gates.delete(portalEndpointKey(state.pair, 'a')); gates.delete(portalEndpointKey(state.pair, 'b')); }
    }
    use.state = { ...this.common(state), phase: 'cooldown', cooldownUntil: now + state.cooldownDurationMs };
    this.publish(id);
    if (collapse && state.phase === 'portals') this.network.broadcastPortalCollapse?.(state.pair,
      use.config.collapseSlowFraction > 0 ? use.config.collapseRadius : state.pair.radius);
    if (collapse && state.phase === 'portals' && use.config.collapseSlowFraction > 0 && this.world) {
      for (const actor of this.world.getActors()) {
        if (actor.kind !== 'enemy' || !actor.alive || !this.world.canDamage(id, actor.id)) continue;
        const da = Math.hypot(actor.x - state.pair.a.x, actor.y - state.pair.a.y);
        const db = Math.hypot(actor.x - state.pair.b.x, actor.y - state.pair.b.y);
        if (Math.min(da, db) <= use.config.collapseRadius) this.world.collapseEnemy(actor,
          da <= db ? state.pair.a : state.pair.b, use.config, id, now);
      }
    }
  }
  private checkTrainHazard(id: string, x: number, y: number, radius: number): void {
    for (const segment of this.trainManager?.getSegmentPositions() ?? []) {
      if (Math.abs(x - segment.x) < radius + 32 && Math.abs(y - segment.y) < radius + 32) {
        this.combatSystem.applyDamage(id, 9999, true, 'train', 'Zug', { sourceX: segment.x, sourceY: segment.y }); break;
      }
    }
  }
  private common(state: TranslocatorUseState) {
    return { useId: state.useId, utilityId: state.utilityId, cooldownDurationMs: state.cooldownDurationMs,
      temporaryUtilityInstanceId: state.temporaryUtilityInstanceId };
  }
  private actorGates(id: string): PortalGates {
    let gates = this.gates.get(id); if (!gates) { gates = new Map(); this.gates.set(id, gates); } return gates;
  }
  private refreshPairs(): void { this.pairView = [...this.pairs.values()]; }
  private publish(id: string): void { this.network.publishTranslocatorUseState?.(id, this.getUseState(id)); }
  removePlayer(id: string): void {
    const state = this.getUseState(id);
    if (state?.phase === 'puck') this.projectilePort.consumePuck(state.projectileId);
    if (state?.phase === 'portals') {
      this.pairs.delete(state.pair.id); this.refreshPairs();
      for (const gates of this.gates.values()) { gates.delete(portalEndpointKey(state.pair, 'a')); gates.delete(portalEndpointKey(state.pair, 'b')); }
    }
    this.uses.delete(id); this.gates.delete(id); this.positions.delete(id);
    this.moveBuffs.delete(id); this.regenBuffs.delete(id); this.publish(id);
  }
  clear(): void {
    for (const id of [...this.uses.keys()]) this.removePlayer(id);
    this.positions.clear(); this.gates.clear(); this.moveBuffs.clear(); this.regenBuffs.clear();
  }
}
