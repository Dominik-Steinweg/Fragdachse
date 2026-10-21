import type { PlayerManager } from '../entities/PlayerManager';
import type { CombatActorStatePort, CombatDamageEffectPort } from '../combat/CombatCapabilities';
import type { TranslocatorUtilityConfig } from '../loadout/LoadoutConfig';
import type { LoadoutUseParams } from '../types';
import type { TranslocatorProjectilePort } from '../projectile/ProjectileExternalInteractionPort';
import type { TranslocatorUseState } from '../loadout/TranslocatorUseState';
import { portalEndpointKey, type PortalPair, type PortalPoint } from './PortalTraversal';
import type { PortalActor, PortalPairSource, PortalTransferFlash, WorldPortalTransport } from './portal/WorldPortalTransport';

export interface TranslocatorNetworkPort {
  readonly getPlayerColor: (playerId: string) => number | undefined;
  readonly broadcastExplosionEffect: (x: number, y: number, radius: number) => void;
  readonly publishTranslocatorUseState?: (playerId: string, state: TranslocatorUseState | null) => void;
  readonly broadcastPortalCollapse?: (pair: PortalPair, radius: number) => void;
}
export interface TranslocatorWorldPort {
  readonly getActors: () => readonly PortalActor[];
  readonly canOccupy: (actor: PortalActor, x: number, y: number) => boolean;
  readonly isFriendly: (ownerId: string, actorId: string) => boolean;
  readonly canDamage: (ownerId: string, actorId: string) => boolean;
}
export type TranslocatorUseOutcome = 'thrown' | 'teleported' | 'opened' | 'closed' | 'blocked';
interface ActiveUse {
  state: TranslocatorUseState;
  readonly config: TranslocatorUtilityConfig;
  invalidRest?: { x: number; y: number; since: number };
}
interface PhaseBuff { readonly value: number; readonly expiresAt: number }
const INVALID_PUCK_RESET_MS = 1000;
const TRANSLOCATOR_FLASH: PortalTransferFlash = { start: 0x55bbff, end: 0xff9b45 };

/** Sole writer of a player's complete translocator lifetime and acquired phase buffs. */
export class TranslocatorSystem implements PortalPairSource {
  readonly transferFlash = TRANSLOCATOR_FLASH;
  private readonly uses = new Map<string, ActiveUse>();
  private readonly pairs = new Map<string, PortalPair>();
  private pairView: readonly PortalPair[] = [];
  private readonly moveBuffs = new Map<string, PhaseBuff>();
  private readonly regenBuffs = new Map<string, PhaseBuff>();
  private world: TranslocatorWorldPort | null = null;
  private onUseCb: ((playerId: string) => void) | null = null;
  constructor(private readonly playerManager: PlayerManager, private readonly projectilePort: TranslocatorProjectilePort,
    private readonly combatSystem: CombatActorStatePort & CombatDamageEffectPort,
    private readonly network: TranslocatorNetworkPort, private readonly transport: WorldPortalTransport) {}

  bindWorld(world: TranslocatorWorldPort | null): void { this.world = world; }
  setUseCallback(cb: ((id: string) => void) | null): void { this.onUseCb = cb; }
  getUseState(id: string): TranslocatorUseState | null { return this.uses.get(id)?.state ?? null; }
  getActivePuckId(id: string): number | undefined {
    const state = this.getUseState(id); return state?.phase === 'puck' ? state.projectileId : undefined;
  }
  hasFollowup(id: string): boolean {
    const state = this.getUseState(id); return state?.phase === 'puck' || state?.phase === 'portals';
  }
  getPortalPairs(): readonly PortalPair[] { return this.pairView; }
  isPortalFriendly(ownerId: string, attackerId: string): boolean { return this.world?.isFriendly(ownerId, attackerId) ?? false; }
  onActorTransferred(pair: PortalPair, actor: PortalActor, now: number): void {
    const use = this.uses.get(pair.ownerId);
    if (actor.kind === 'player' && use && this.world?.isFriendly(pair.ownerId, actor.id)) this.applyBuffs(actor.id, use.config, now);
  }
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
    if (this.uses.get(id)?.state.useId !== useId || !this.combatSystem.isAlive(id)) return 'blocked';
    this.updateUse(id, now);
    const use = this.uses.get(id);
    if (!use || use.state.useId !== useId) return 'blocked';
    if (use.state.phase === 'portals') { this.finish(id, use, now, true); return 'closed'; }
    return use.state.phase === 'puck' ? this.teleport(id, use, now) : 'blocked';
  }

  private teleport(id: string, use: ActiveUse, now: number): TranslocatorUseOutcome {
    if (!this.world || use.state.phase !== 'puck') return 'blocked';
    const destination = this.projectilePort.getPuckPosition(use.state.projectileId);
    const actor = this.world.getActors().find(a => a.id === id);
    const cfg = use.config;
    if (!destination || !actor || !this.canTeleportTo(actor, destination, cfg)) return 'blocked';
    if (!this.projectilePort.consumePuck(use.state.projectileId)) return 'blocked';
    const pair: PortalPair | null = cfg.portalEnabled > 0 ? { id: use.state.useId, ownerId: id,
      a: { ...destination }, b: { x: actor.x, y: actor.y }, radius: cfg.portalRadius,
      reentryDistance: cfg.portalReentryDistance, damageBonus: cfg.portalDamageBonus,
      createdAt: now, expiresAt: now + cfg.portalDurationMs } : null;
    if (pair) {
      use.state = { ...this.common(use.state), phase: 'portals', pair };
      this.pairs.set(pair.id, pair); this.refreshPairs();
      this.transport.gateActor(id, portalEndpointKey(pair, 'a'), { center: pair.a, releaseDistance: pair.reentryDistance });
    } else use.state = { ...this.common(use.state), phase: 'cooldown', cooldownUntil: now + use.state.cooldownDurationMs };
    this.onUseCb?.(id);
    this.transport.jump(actor, destination.x, destination.y, this.transferFlash);
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
    this.transport.checkExitHazard(id, destination.x, destination.y, actor.radius);
    this.updateUse(id, now);
    if (pair && this.pairs.has(pair.id)) this.transport.transferActors(now, true);
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
    } else if (state.phase === 'puck' && this.world) {
      const point = this.projectilePort.getPuckPosition(state.projectileId)!;
      const actor = this.world.getActors().find(a => a.id === id);
      if (!actor || this.canTeleportTo(actor, point, use.config)) {
        use.invalidRest = undefined;
      } else if (!use.invalidRest || Math.hypot(point.x - use.invalidRest.x, point.y - use.invalidRest.y) > 0.5) {
        // Measure against the rest anchor, so even slow cumulative drift restarts the grace period.
        use.invalidRest = { ...point, since: now };
      } else if (now - use.invalidRest.since >= INVALID_PUCK_RESET_MS) {
        this.projectilePort.consumePuck(state.projectileId);
        this.uses.delete(id);
        this.publish(id); // Failed deployment is ready again, without a teleport cooldown.
      }
    }
  }

  private canTeleportTo(actor: PortalActor, point: PortalPoint, config: TranslocatorUtilityConfig): boolean {
    return !!this.world?.canOccupy(actor, point.x, point.y)
      && (config.portalEnabled <= 0 || Math.hypot(point.x - actor.x, point.y - actor.y) >= config.portalMinSeparation);
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
      this.transport.forgetPair(state.pair);
    }
    use.state = { ...this.common(state), phase: 'cooldown', cooldownUntil: now + state.cooldownDurationMs };
    this.publish(id);
    if (collapse && state.phase === 'portals') this.network.broadcastPortalCollapse?.(state.pair,
      use.config.collapseSlowFraction > 0 ? use.config.collapseRadius : state.pair.radius);
    if (collapse && state.phase === 'portals' && use.config.collapseSlowFraction > 0 && this.world) {
      const world = this.world;
      this.transport.collapse(state.pair, use.config, id, actor => world.canDamage(id, actor.id), now);
    }
  }
  private common(state: TranslocatorUseState) {
    return { useId: state.useId, utilityId: state.utilityId, cooldownDurationMs: state.cooldownDurationMs,
      temporaryUtilityInstanceId: state.temporaryUtilityInstanceId };
  }
  private refreshPairs(): void { this.pairView = [...this.pairs.values()]; }
  private publish(id: string): void { this.network.publishTranslocatorUseState?.(id, this.getUseState(id)); }
  removePlayer(id: string): void {
    const state = this.getUseState(id);
    if (state?.phase === 'puck') this.projectilePort.consumePuck(state.projectileId);
    if (state?.phase === 'portals') {
      this.pairs.delete(state.pair.id); this.refreshPairs();
      this.transport.forgetPair(state.pair);
    }
    this.uses.delete(id);
    this.moveBuffs.delete(id); this.regenBuffs.delete(id); this.publish(id);
  }
  clear(): void {
    for (const id of [...this.uses.keys()]) this.removePlayer(id);
    this.moveBuffs.clear(); this.regenBuffs.clear();
  }
}
