import Phaser from 'phaser';
import type { PlayerManager }      from '../entities/PlayerManager';
import type { CombatSystem }       from './CombatSystem';
import type { HostPhysicsSystem }  from './HostPhysicsSystem';
import type { NetworkBridge }      from '../network/NetworkBridge';
import type { ResourceSystem }     from './ResourceSystem';
import type { BurrowPhase }        from '../types';
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
  PLAYER_SIZE, TRUNK_RADIUS,
} from '../config';

interface BurrowStateData {
  phase: BurrowPhase;
  phaseEndsAt: number;
  drainElapsedMs: number;
  stuckDamageAccum: number;
}

export class BurrowSystem {
  private states = new Map<string, BurrowStateData>();

  private rockGroup:  Phaser.Physics.Arcade.StaticGroup | null = null;
  private trunkGroup: Phaser.Physics.Arcade.StaticGroup | null = null;

  constructor(
    private resources:    ResourceSystem,
    private playerMgr:    PlayerManager,
    private combat:       CombatSystem,
    private hostPhysics:  HostPhysicsSystem,
    private bridge:       NetworkBridge,
  ) {}

  // ── Obstacle-Gruppen (nach Arena-Aufbau setzen) ───────────────────────────

  setGroups(
    rock:  Phaser.Physics.Arcade.StaticGroup | null,
    trunk: Phaser.Physics.Arcade.StaticGroup | null,
  ): void {
    this.rockGroup  = rock;
    this.trunkGroup = trunk;
  }

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
        return BURROW_UNDERGROUND_SPEED_FACTOR;
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

  update(delta: number): void {
    const now = Date.now();

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
          this.updateUndergroundState(id, state, delta);
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

  private updateUndergroundState(id: string, state: BurrowStateData, delta: number): void {
    state.drainElapsedMs += delta;
    while (state.drainElapsedMs >= BURROW_DRAIN_INTERVAL_MS) {
      state.drainElapsedMs -= BURROW_DRAIN_INTERVAL_MS;
      this.resources.drainAdrenaline(id, BURROW_DRAIN_AMOUNT_PER_TICK);
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
      this.combat.applyDamage(id, damage, true);
      state.stuckDamageAccum -= damage;
    }

    if (!this.isOverlappingStatic(id)) {
      this.finalizeExit(id);
    }
  }

  // ── Privat ─────────────────────────────────────────────────────────────────

  private startWindUp(id: string): void {
    this.states.set(id, {
      phase: 'windup',
      phaseEndsAt: Date.now() + BURROW_WINDUP_DURATION_MS,
      drainElapsedMs: 0,
      stuckDamageAccum: 0,
    });
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
    this.bridge.broadcastBurrowVisual(id, 'underground');
  }

  private requestExit(id: string, reason: 'manual' | 'depleted'): void {
    const state = this.states.get(id);
    if (!state || state.phase !== 'underground') return;

    if (this.isOverlappingStatic(id)) {
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

    this.finalizeExit(id);
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

  /**
   * Prüft ob der Spieler-Sprite ein Rock- oder Trunk-Objekt überlappt.
   */
  private isOverlappingStatic(id: string): boolean {
    const player = this.playerMgr.getPlayer(id);
    if (!player) return false;

    const bounds = player.sprite.getBounds();

    // Felsen-Overlap (Rechteck-Bounds)
    if (this.rockGroup) {
      for (const child of this.rockGroup.getChildren()) {
        if (!child.active) continue;
        const rock = child as Phaser.GameObjects.Image;
        if (Phaser.Geom.Intersects.RectangleToRectangle(bounds, rock.getBounds())) {
          return true;
        }
      }
    }

    // Trunk-Overlap (Kreisdistanz)
    if (this.trunkGroup) {
      for (const child of this.trunkGroup.getChildren()) {
        if (!child.active) continue;
        const trunk = child as Phaser.GameObjects.Arc;
        const dx    = player.sprite.x - trunk.x;
        const dy    = player.sprite.y - trunk.y;
        if (Math.sqrt(dx * dx + dy * dy) < TRUNK_RADIUS + PLAYER_SIZE / 2) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * AoE-Knockback + Schaden für Spieler im SHOCKWAVE_RADIUS um den Auftauchenden.
   */
  private applyShockwave(id: string): void {
    const origin = this.playerMgr.getPlayer(id);
    if (!origin) return;

    const ox = origin.sprite.x;
    const oy = origin.sprite.y;

    for (const other of this.playerMgr.getAllPlayers()) {
      if (other.id === id) continue;
      if (!this.combat.isAlive(other.id)) continue;

      const dx   = other.sprite.x - ox;
      const dy   = other.sprite.y - oy;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < SHOCKWAVE_RADIUS && dist > 0) {
        this.combat.applyDamage(other.id, SHOCKWAVE_DAMAGE);
        const nx = dx / dist;
        const ny = dy / dist;
        (other.sprite.body as Phaser.Physics.Arcade.Body)
          .setVelocity(nx * SHOCKWAVE_KNOCKBACK, ny * SHOCKWAVE_KNOCKBACK);
      }
    }

    // Visueller Effekt für alle Clients (inkl. Host)
    this.bridge.broadcastShockwaveEffect(ox, oy);
  }
}
