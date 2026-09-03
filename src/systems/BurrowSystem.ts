import type { PlayerManager }      from '../entities/PlayerManager';
import type { CombatSystem }       from './CombatSystem';
import type { HostPhysicsSystem }  from './HostPhysicsSystem';
import type { NetworkBridge }      from '../network/NetworkBridge';
import type { ResourceSystem }     from './ResourceSystem';
import type { BurrowPhase }        from '../types';
import type { WorldMetrics }       from '../world/WorldMetrics';
import { resolveBurrowExitPosition } from './BurrowExitPositionResolver';
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

type StinkCloudSystemType = { hostDeactivateForPlayer(id: string): void };

export class BurrowSystem {
  private states = new Map<string, BurrowStateData>();
  private undergroundSpeedResolver: ((playerId: string) => number) | null = null;
  private drainMultiplierResolver: ((playerId: string) => number) | null = null;
  private shockwaveDamageResolver: ((playerId: string) => number) | null = null;
  private shockwaveRadiusResolver: ((playerId: string) => number) | null = null;

  private stinkCloudSystem: StinkCloudSystemType | null = null;
  private onBurrowStartCb: ((playerId: string) => void) | null = null;
  private worldMetrics: WorldMetrics | null = null;
  private onPositionResetCb: ((playerId: string, x: number, y: number) => void) | null = null;
  private onTunnelTransitEndedCb: ((playerId: string) => void) | null = null;

  constructor(
    private resources:    ResourceSystem,
    private playerMgr:    PlayerManager,
    private combat:       CombatSystem,
    private hostPhysics:  HostPhysicsSystem,
    private bridge:       NetworkBridge,
  ) {}

  setWorldMetrics(metrics: WorldMetrics | null): void {
    this.worldMetrics = metrics;
  }

  setStinkCloudSystem(sc: StinkCloudSystemType | null): void {
    this.stinkCloudSystem = sc;
  }

  setBurrowStartCallback(cb: ((playerId: string) => void) | null): void {
    this.onBurrowStartCb = cb;
  }

  setPositionResetCallback(cb: ((playerId: string, x: number, y: number) => void) | null): void {
    this.onPositionResetCb = cb;
  }

  setTunnelTransitEndedCallback(cb: ((playerId: string) => void) | null): void {
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
            this.completeWindUp(id);
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
    this.bridge.broadcastBurrowVisual(id, 'windup');
  }

  private completeWindUp(id: string): void {
    const state = this.states.get(id);
    if (!state || state.phase !== 'windup') return;

    this.states.set(id, {
      phase: 'underground',
      phaseEndsAt: 0,
      drainElapsedMs: 0,
      stuckDamageAccum: 0,
    });
    this.hostPhysics.setPlayerBurrowed(id, true);
    this.stinkCloudSystem?.hostDeactivateForPlayer(id);
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

  private tryFinalizeExit(id: string): boolean {
    const player = this.playerMgr.getPlayer(id);
    if (!player) {
      // Preserve teardown-safe behavior: a missing player runtime was previously treated as
      // non-blocking by the static check.
      this.finalizeExit(id);
      return true;
    }

    const input = this.bridge.getPlayerInput(id);
    const resolved = this.worldMetrics
      ? resolveBurrowExitPosition(
        this.worldMetrics,
        this.combat.getObstacleIndex(),
        player.x,
        player.y,
        player.getCollisionRadius(),
        input?.dx ?? 0,
        input?.dy ?? 0,
      )
      : this.isCurrentPositionBlocked(id)
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
    this.bridge.broadcastBurrowVisual(id, 'recovery');
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

  completeTunnelTransit(id: string): void {
    const state = this.states.get(id);
    if (!state?.isTunnelTransit) return;
    this.finalizeTunnelTransit(id);
  }

  private finalizeTunnelTransit(id: string): void {
    this.hostPhysics.setPlayerBurrowed(id, false);
    this.states.set(id, {
      phase: 'recovery',
      phaseEndsAt: Date.now() + BURROW_POPOUT_WEAPON_LOCK_MS,
      drainElapsedMs: 0,
      stuckDamageAccum: 0,
      isTunnelTransit: false,
    });
    this.bridge.broadcastBurrowVisual(id, 'recovery');
    this.onTunnelTransitEndedCb?.(id);
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
  private isCurrentPositionBlocked(id: string): boolean {
    const player = this.playerMgr.getPlayer(id);
    if (!player) return false;
    return this.combat.getObstacleIndex().isCircleBlocked(
      player.x,
      player.y,
      player.getCollisionRadius(),
    );
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
    this.bridge.broadcastShockwaveEffect(ox, oy);
  }
}
