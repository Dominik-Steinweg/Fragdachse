import type { PlayerManager }      from '../entities/PlayerManager';
import type { CombatActorStatePort, CombatDamageEffectPort } from '../combat/CombatCapabilities';
import type { HostPhysicsSystem }  from './HostPhysicsSystem';
import type { NetworkBridge }      from '../network/NetworkBridge';
import type { ResourceSystem }     from './ResourceSystem';
import type { BurrowPhase }        from '../types';
import type { WorldMetrics }       from '../world/WorldMetrics';
import { resolveBurrowExitPosition } from './BurrowExitPositionResolver';
import type { WorldGeometryQueries } from '../world/WorldGeometryQueries';
import {
  BURROW_DRAIN_AMOUNT_PER_TICK,
  BURROW_DRAIN_INTERVAL_MS,
  BURROW_MIN_ADRENALINE,
  BURROW_POPOUT_WEAPON_LOCK_MS,
  BURROW_STUCK_DAMAGE_PER_SEC,
  BURROW_UNDERGROUND_SPEED_FACTOR,
  BURROW_WINDUP_DURATION_MS,
  BURROW_WINDUP_SPEED_FACTOR,
  SHOCKWAVE_RADIUS, SHOCKWAVE_DAMAGE, SHOCKWAVE_KNOCKBACK,
  PLAYER_SIZE,
} from '../config';

interface BurrowStateData {
  phase: BurrowPhase;
  phaseEndsAt: number;
  drainElapsedMs: number;
  stuckDamageAccum: number;
  isTunnelTransit?: boolean;
}

type StinkCloudSystemType = { hostDeactivateForPlayer(id: string, now?: number): void };

export class BurrowSystem {
  private states = new Map<string, BurrowStateData>();
  private undergroundSpeedResolver: ((playerId: string) => number) | null = null;
  private drainMultiplierResolver: ((playerId: string) => number) | null = null;
  private shockwaveDamageResolver: ((playerId: string) => number) | null = null;
  private shockwaveRadiusResolver: ((playerId: string) => number) | null = null;

  private stinkCloudSystem: StinkCloudSystemType | null = null;
  private onBurrowStartCb: ((playerId: string) => void) | null = null;
  private readonly burrowStartObservers = new Set<(playerId: string) => void>();
  private worldMetrics: WorldMetrics | null = null;
  private onPositionResetCb: ((playerId: string, x: number, y: number) => void) | null = null;
  private onTunnelTransitEndedCb: ((playerId: string, nowMs: number) => void) | null = null;
  private worldGeometryQueries: WorldGeometryQueries | null = null;

  constructor(
    private resources:    ResourceSystem,
    private playerMgr:    PlayerManager,
    private combat:       CombatActorStatePort & CombatDamageEffectPort,
    private hostPhysics:  HostPhysicsSystem,
    private bridge:       NetworkBridge,
  ) {}

  setWorldMetrics(metrics: WorldMetrics | null): void {
    this.worldMetrics = metrics;
  }

  setWorldGeometryQueries(queries: WorldGeometryQueries | null): void {
    this.worldGeometryQueries = queries;
  }

  setStinkCloudSystem(sc: StinkCloudSystemType | null): void {
    this.stinkCloudSystem = sc;
  }

  setBurrowStartCallback(cb: ((playerId: string) => void) | null): void {
    this.onBurrowStartCb = cb;
  }

  addBurrowStartObserver(observer: (playerId: string) => void): () => void {
    this.burrowStartObservers.add(observer);
    return () => { this.burrowStartObservers.delete(observer); };
  }

  setPositionResetCallback(cb: ((playerId: string, x: number, y: number) => void) | null): void {
    this.onPositionResetCb = cb;
  }

  setTunnelTransitEndedCallback(cb: ((playerId: string, nowMs: number) => void) | null): void {
    this.onTunnelTransitEndedCb = cb;
  }

  setUndergroundSpeedResolver(resolver: ((playerId: string) => number) | null): void {
    this.undergroundSpeedResolver = resolver;
  }
  setDrainMultiplierResolver(resolver: ((playerId: string) => number) | null): void { this.drainMultiplierResolver = resolver; }
  setShockwaveDamageResolver(resolver: ((playerId: string) => number) | null): void { this.shockwaveDamageResolver = resolver; }
  setShockwaveRadiusResolver(resolver: ((playerId: string) => number) | null): void { this.shockwaveRadiusResolver = resolver; }

  // ── Spieler-Lifecycle ──────────────────────────────────────────────────────

  initPlayer(id: string): void {
    this.resetState(id, false);
  }

  removePlayer(id: string): void {
    this.resetState(id, false);
  }

  // ── Abfragen ───────────────────────────────────────────────────────────────

  getPhase(id: string): BurrowPhase {
    return this.states.get(id)?.phase ?? 'idle';
  }

  isTunnelTransit(id: string): boolean {
    return this.states.get(id)?.isTunnelTransit === true;
  }

  isBurrowed(id: string): boolean {
    const phase = this.getPhase(id);
    return phase === 'underground' || phase === 'trapped';
  }

  isStunned(id: string): boolean {
    return false;
  }

  isDashBlocked(id: string): boolean {
    const phase = this.getPhase(id);
    return phase === 'windup' || phase === 'underground' || phase === 'trapped';
  }

  isWeaponBlocked(id: string): boolean {
    return this.getPhase(id) !== 'idle';
  }

  isUtilityBlocked(id: string): boolean {
    const phase = this.getPhase(id);
    return phase === 'windup' || phase === 'underground' || phase === 'trapped';
  }

  getMovementSpeedFactor(id: string): number {
    switch (this.getPhase(id)) {
      case 'windup':
        return BURROW_WINDUP_SPEED_FACTOR;
      case 'underground':
      case 'trapped':
        return this.undergroundSpeedResolver?.(id) ?? BURROW_UNDERGROUND_SPEED_FACTOR;
      default:
        return 1;
    }
  }

  // ── RPC-Handler ───────────────────────────────────────────────────────────

  /** Commit a safe, ordinary Burrow exit before physics starts the surface dash. */
  tryExitBurrowForDash(id: string): boolean {
    const state = this.states.get(id);
    if (state?.phase !== 'underground' || state.isTunnelTransit) return false;
    if (!this.combat.isAlive(id) || !this.playerMgr.getPlayer(id)) return false;
    return this.tryFinalizeExit(id, PLAYER_SIZE / 2);
  }

  /**
   * Wird aufgerufen wenn ein Client graben oder auftauchen möchte.
   */
  handleBurrowRequest(id: string, wantsBurrowed: boolean): void {
    if (!this.combat.isAlive(id)) return;
    const phase = this.getPhase(id);

    if (wantsBurrowed) {
      if (phase !== 'idle') return;
      if (this.resources.getAdrenaline(id) < BURROW_MIN_ADRENALINE) return;
      this.startWindUp(id);
      return;
    }

    if (phase === 'underground') {
      this.requestExit(id, 'manual');
    }
  }

  // ── Frame-Update (Host) ───────────────────────────────────────────────────

  update(delta: number, nowMs?: number): void {
    const now = nowMs ?? Date.now();

    for (const [id, state] of [...this.states]) {
      if (!this.combat.isAlive(id)) {
        this.resetState(id, true);
        continue;
      }

      switch (state.phase) {
        case 'windup':
          if (now >= state.phaseEndsAt) {
            this.completeWindUp(id, now);
          }
          break;
        case 'underground':
          this.updateUndergroundState(id, state, delta, now);
          break;
        case 'trapped':
          this.updateTrappedState(id, state, delta);
          break;
        case 'recovery':
          if (now >= state.phaseEndsAt) {
            this.states.delete(id);
          }
          break;
        default:
          break;
      }
    }
  }

  private updateUndergroundState(id: string, state: BurrowStateData, delta: number, now: number): void {
    if (state.isTunnelTransit) return;
    state.drainElapsedMs += delta;
    while (state.drainElapsedMs >= BURROW_DRAIN_INTERVAL_MS) {
      state.drainElapsedMs -= BURROW_DRAIN_INTERVAL_MS;
      this.resources.drainAdrenaline(
        id,
        BURROW_DRAIN_AMOUNT_PER_TICK * Math.max(0, this.drainMultiplierResolver?.(id) ?? 1),
        now,
      );
      if (this.resources.getAdrenaline(id) <= 0) {
        this.requestExit(id, 'depleted');
        return;
      }
    }
  }

  private updateTrappedState(id: string, state: BurrowStateData, delta: number): void {
    state.stuckDamageAccum += BURROW_STUCK_DAMAGE_PER_SEC * delta / 1000;

    if (state.stuckDamageAccum >= 1) {
      const damage = Math.floor(state.stuckDamageAccum);
      const player = this.playerMgr.getPlayer(id);
      this.combat.applyDamage(id, damage, true, undefined, undefined, player
        ? { sourceX: player.x, sourceY: player.y - PLAYER_SIZE }
        : undefined);
      state.stuckDamageAccum -= damage;
    }

    this.tryFinalizeExit(id);
  }

  // ── Privat ─────────────────────────────────────────────────────────────────

  private startWindUp(id: string): void {
    this.states.set(id, {
      phase: 'windup',
      phaseEndsAt: Date.now() + BURROW_WINDUP_DURATION_MS,
      drainElapsedMs: 0,
      stuckDamageAccum: 0,
    });
    this.onBurrowStartCb?.(id);
    for (const observer of this.burrowStartObservers) observer(id);
    const player = this.playerMgr.getPlayer(id);
    this.bridge.broadcastBurrowVisual(id, 'windup', player?.x, player?.y);
  }

  private completeWindUp(id: string, now: number): void {
    const state = this.states.get(id);
    if (!state || state.phase !== 'windup') return;

    this.states.set(id, {
      phase: 'underground',
      phaseEndsAt: 0,
      drainElapsedMs: 0,
      stuckDamageAccum: 0,
    });
    this.hostPhysics.setPlayerBurrowed(id, true);
    this.stinkCloudSystem?.hostDeactivateForPlayer(id, now);
    this.bridge.broadcastBurrowVisual(id, 'underground');
  }

  private requestExit(id: string, reason: 'manual' | 'depleted'): void {
    const state = this.states.get(id);
    if (!state || state.phase !== 'underground') return;

    if (state.isTunnelTransit) {
      if (this.isCurrentPositionBlocked(id)) return;
      this.finalizeTunnelTransit(id);
      return;
    }

    if (!this.tryFinalizeExit(id)) {
      if (reason === 'depleted') {
        this.states.set(id, {
          phase: 'trapped',
          phaseEndsAt: 0,
          drainElapsedMs: 0,
          stuckDamageAccum: 0,
        });
      }
      return;
    }
  }

  private tryFinalizeExit(id: string, collisionRadius?: number): boolean {
    const player = this.playerMgr.getPlayer(id);
    if (!player) {
      // Preserve teardown-safe behavior: a missing player runtime was previously treated as
      // non-blocking by the static check.
      this.finalizeExit(id);
      return true;
    }

    const input = this.bridge.getPlayerInput(id);
    const resolved = this.worldMetrics
      ? this.worldGeometryQueries
        ? resolveBurrowExitPosition(
          this.worldMetrics,
          this.worldGeometryQueries,
          player.x,
          player.y,
          collisionRadius ?? player.getCollisionRadius(),
          input?.dx ?? 0,
          input?.dy ?? 0,
        )
        : null
      : this.isCurrentPositionBlocked(id, collisionRadius)
        ? null
        : { x: player.x, y: player.y };
    if (!resolved) return false;

    if (resolved.x !== player.x || resolved.y !== player.y) {
      player.setPosition(resolved.x, resolved.y);
      this.onPositionResetCb?.(id, resolved.x, resolved.y);
    }
    this.finalizeExit(id);
    return true;
  }

  private finalizeExit(id: string): void {
    this.hostPhysics.setPlayerBurrowed(id, false);
    this.states.set(id, {
      phase: 'recovery',
      phaseEndsAt: Date.now() + BURROW_POPOUT_WEAPON_LOCK_MS,
      drainElapsedMs: 0,
      stuckDamageAccum: 0,
    });
    const player = this.playerMgr.getPlayer(id);
    this.bridge.broadcastBurrowVisual(id, 'recovery', player?.x, player?.y);
    this.applyShockwave(id);
  }

  startTunnelTransit(id: string): void {
    if (!this.combat.isAlive(id)) return;
    this.states.set(id, {
      phase: 'underground',
      phaseEndsAt: 0,
      drainElapsedMs: 0,
      stuckDamageAccum: 0,
      isTunnelTransit: true,
    });
    this.hostPhysics.setPlayerBurrowed(id, true);
    this.bridge.broadcastBurrowVisual(id, 'underground');
  }

  completeTunnelTransit(id: string, nowMs = Date.now()): void {
    const state = this.states.get(id);
    if (!state?.isTunnelTransit) return;
    this.finalizeTunnelTransit(id, nowMs);
  }

  private finalizeTunnelTransit(id: string, nowMs = Date.now()): void {
    this.hostPhysics.setPlayerBurrowed(id, false);
    this.states.set(id, {
      phase: 'recovery',
      phaseEndsAt: nowMs + BURROW_POPOUT_WEAPON_LOCK_MS,
      drainElapsedMs: 0,
      stuckDamageAccum: 0,
      isTunnelTransit: false,
    });
    const player = this.playerMgr.getPlayer(id);
    this.bridge.broadcastBurrowVisual(id, 'recovery', player?.x, player?.y);
    this.onTunnelTransitEndedCb?.(id, nowMs);
  }

  private resetState(id: string, broadcastIdle: boolean): void {
    const phase = this.getPhase(id);
    if (phase === 'idle') return;

    if (phase === 'underground' || phase === 'trapped') {
      this.hostPhysics.setPlayerBurrowed(id, false);
    }
    this.states.delete(id);
    if (broadcastIdle) {
      this.bridge.broadcastBurrowVisual(id, 'idle');
    }
  }

  /** Prüft nur die aktuelle Player-Kreisposition gegen den gemeinsamen Hindernis-Index. */
  private isCurrentPositionBlocked(id: string, collisionRadius?: number): boolean {
    const player = this.playerMgr.getPlayer(id);
    if (!player) return false;
    // An active World must provide the authoritative geometry query. Treat a missing binding as
    // blocked so tunnel exits cannot silently bypass obstacle validation during composition races.
    if (this.worldMetrics && !this.worldGeometryQueries) return true;
    return this.worldGeometryQueries?.isCircleBlocked(
      player.x,
      player.y,
      collisionRadius ?? player.getCollisionRadius(),
    ) ?? false;
  }

  /**
   * AoE-Knockback + Schaden für Spieler im SHOCKWAVE_RADIUS um den Auftauchenden.
   */
  private applyShockwave(id: string): void {
    const origin = this.playerMgr.getPlayer(id);
    if (!origin) return;

    const ox = origin.x;
    const oy = origin.y;
    const shockwaveRadius = this.shockwaveRadiusResolver?.(id) ?? SHOCKWAVE_RADIUS;
    const shockwaveDamage = this.shockwaveDamageResolver?.(id) ?? SHOCKWAVE_DAMAGE;

    this.hostPhysics.applyRadialImpulse(
      ox,
      oy,
      shockwaveRadius,
      SHOCKWAVE_KNOCKBACK,
      id,
      0,
    );

    for (const other of this.playerMgr.getAllPlayers()) {
      if (other.id === id) continue;
      if (!this.combat.isAlive(other.id)) continue;

      const dx   = other.x - ox;
      const dy   = other.y - oy;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < shockwaveRadius && dist > 0) {
        this.combat.applyDamage(other.id, shockwaveDamage, false, id, 'Auftauchschockwelle', {
          sourceX: ox,
          sourceY: oy,
        });
      }
    }

    // Visueller Effekt für alle Clients (inkl. Host)
    this.bridge.broadcastShockwaveEffect(ox, oy, shockwaveRadius);
  }
}
