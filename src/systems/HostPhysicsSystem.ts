import * as Phaser from 'phaser';
import type { EnemyEntity } from '../entities/EnemyEntity';
import type { EnemyManager } from '../entities/EnemyManager';
import type { PlayerManager } from '../entities/PlayerManager';
import type { NetworkBridge } from '../network/NetworkBridge';
import type { CombatSystem }  from './CombatSystem';
import type { TimeBubbleSystem } from './TimeBubbleSystem';
import {
  PLAYER_SPEED, PLAYER_SIZE,
  DASH_T1_S, DASH_T2_S, DASH_F_MIN, DASH_F_START, DASH_HOLD_MAX_DURATION_FACTOR,
} from '../config';
import { TRAIN } from '../train/TrainConfig';
import { getDashBurstTiming } from '../utils/dashTiming';

// Zirkuläre Abhängigkeiten vermeiden: nur Typ-Imports
type BurrowSystemType   = {
  isBurrowed(id: string): boolean;
  isStunned(id: string): boolean;
  isDashBlocked(id: string): boolean;
  getMovementSpeedFactor(id: string): number;
};
type LoadoutManagerType = {
  getSpeedMultiplier(id: string): number;
  getHeldSelfPushVelocity(id: string): { vx: number; vy: number } | null;
};

interface DashState {
  phase:   1 | 2;
  startMs: number;   // Zeitstempel Phasenbeginn
  dirX:    number;   // normierter Startrichtungsvektor
  dirY:    number;
  vNorm:   number;   // v_norm zum Dash-Zeitpunkt (skaliert mit Buffs)
  hitIds: Set<string>;
  lastGroundX: number;
  lastGroundY: number;
}

/**
 * Ausweichschritt eines Gegners. Nutzt dieselbe Zweiphasen-Kurve wie der Spieler-Dash
 * (Burst mit Quad.easeOut, danach zähes Aufrappeln), aber ohne Upgrade-Einflüsse, ohne
 * Air-Control und ohne Aufprallschaden – der Standard-Dash also.
 */
interface EnemyDashState {
  phase:   1 | 2;
  startMs: number;
  dirX:    number;
  dirY:    number;
  vNorm:   number;
}

type DashGroundFireHandler = (
  playerId: string,
  sourceKey: string,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  durationMs: number,
  now: number,
) => void;

interface ExternalImpulse {
  vx: number;
  vy: number;
  startMs: number;
  durationMs: number;
  sourcePlayerId?: string;
}

interface RecentImpulseSource {
  sourcePlayerId: string;
  expiresAt: number;
}

interface ForcedMovement {
  vx: number;
  vy: number;
}

export class HostPhysicsSystem {
  private scene:         Phaser.Scene;
  private playerManager: PlayerManager;
  private bridge:        NetworkBridge;
  private combatSystem:  CombatSystem;

  // Obstacle-Gruppen – werden nach Arena-Aufbau injiziert
  private rockGroup:   Phaser.Physics.Arcade.StaticGroup | null = null;
  private trunkGroup:  Phaser.Physics.Arcade.StaticGroup | null = null;
  private baseGroup:   Phaser.Physics.Arcade.StaticGroup | null = null;

  // Pro-Spieler Collider-Tracking
  private rockCollidersSetup  = new Set<string>();
  private trunkCollidersSetup = new Set<string>();
  private baseCollidersSetup  = new Set<string>();
  private playerColliders     = new Map<string, Phaser.Physics.Arcade.Collider[]>();
  private enemyRockCollidersSetup  = new Set<string>();
  private enemyTrunkCollidersSetup = new Set<string>();
  private enemyBaseCollidersSetup  = new Set<string>();
  private enemyColliders           = new Map<string, Phaser.Physics.Arcade.Collider[]>();
  private burrowedEnemies          = new Set<string>();

  // Optionale Referenzen
  private burrowSystem:   BurrowSystemType   | null = null;
  private loadoutManager: LoadoutManagerType | null = null;
  private timeBubbleSystem: TimeBubbleSystem | null = null;
  private enemyManager: EnemyManager | null = null;
  private runSpeedResolver: ((playerId: string) => number) | null = null;
  private dashRangeMultiplierResolver: ((playerId: string) => number) | null = null;
  private dashRecoveryDurationResolver: ((playerId: string) => number) | null = null;
  private dashImpactDamageResolver: ((playerId: string) => number) | null = null;
  private dashImpactKnockbackResolver: ((playerId: string) => number) | null = null;
  private dashGroundFireDurationResolver: ((playerId: string) => number) | null = null;
  private dashGroundFireHandler: DashGroundFireHandler | null = null;
  private dashHoldEnabledResolver: ((playerId: string) => boolean) | null = null;
  private enemyMovementFactorResolver: ((enemyId: string, now: number) => number) | null = null;
  private enemyRockContactCallback: ((enemyId: string, rock: Phaser.GameObjects.Image, now: number) => void) | null = null;

  // Dash-Zustand pro Spieler (2-Phasen Speed-Debt-Modell)
  private dashStates       = new Map<string, DashState>();
  private dashBurstPlayers = new Set<string>(); // Phase 1 aktiv → Schießen blockiert
  private enemyDashStates  = new Map<string, EnemyDashState>();

  // Burrow-State (Collider-Enable-Tracking)
  private burrowedPlayers = new Set<string>();

  // Rückstoß-Impulse (Zeit-basiertes Quad-Ease-Out Decay über mehrere Frames)
  private pendingRecoils = new Map<string, ExternalImpulse[]>();
  private recentImpulseSources = new Map<string, RecentImpulseSource>();
  private forcedMovement = new Map<string, ForcedMovement>();

  constructor(
    scene:         Phaser.Scene,
    playerManager: PlayerManager,
    bridge:        NetworkBridge,
    combatSystem:  CombatSystem,
  ) {
    this.scene         = scene;
    this.playerManager = playerManager;
    this.bridge        = bridge;
    this.combatSystem  = combatSystem;
  }

  // ── Referenz-Injection ────────────────────────────────────────────────────

  setBurrowSystem(bs: BurrowSystemType | null): void       { this.burrowSystem   = bs; }
  setLoadoutManager(lm: LoadoutManagerType | null): void  { this.loadoutManager = lm; }
  setTimeBubbleSystem(system: TimeBubbleSystem | null): void { this.timeBubbleSystem = system; }

  getWorldMovementFactorAt(x: number, y: number, now = Date.now()): number {
    return this.timeBubbleSystem?.getPlayerMovementFactorAt(x, y, now) ?? 1;
  }
  setEnemyManager(manager: EnemyManager | null): void { this.enemyManager = manager; }
  setRunSpeedResolver(resolver: ((playerId: string) => number) | null): void { this.runSpeedResolver = resolver; }
  setDashRangeMultiplierResolver(resolver: ((playerId: string) => number) | null): void { this.dashRangeMultiplierResolver = resolver; }
  setDashRecoveryDurationResolver(resolver: ((playerId: string) => number) | null): void { this.dashRecoveryDurationResolver = resolver; }
  setDashImpactDamageResolver(resolver: ((playerId: string) => number) | null): void { this.dashImpactDamageResolver = resolver; }
  setDashImpactKnockbackResolver(resolver: ((playerId: string) => number) | null): void { this.dashImpactKnockbackResolver = resolver; }
  setDashGroundFireDurationResolver(resolver: ((playerId: string) => number) | null): void { this.dashGroundFireDurationResolver = resolver; }
  setDashGroundFireHandler(handler: DashGroundFireHandler | null): void { this.dashGroundFireHandler = handler; }
  setDashHoldEnabledResolver(resolver: ((playerId: string) => boolean) | null): void { this.dashHoldEnabledResolver = resolver; }
  setEnemyMovementFactorResolver(resolver: ((enemyId: string, now: number) => number) | null): void { this.enemyMovementFactorResolver = resolver; }
  setEnemyRockContactCallback(
    callback: ((enemyId: string, rock: Phaser.GameObjects.Image, now: number) => void) | null,
  ): void {
    this.enemyRockContactCallback = callback;
  }

  // ── Rückstoß ─────────────────────────────────────────────────────────────

  /**
   * Startet einen zeitbasierter Rückstoß-Impuls (Quad-Ease-Out Decay über durationMs).
   * Wird in HostPhysicsSystem.update() additiv zur regulären Velocity addiert.
   * Amplitude zum Zeitpunkt t: force * (1 - t/duration)²
   *
   * Zielt der Impuls auf einen Gegner, wird er mit dessen Wegstossfaktor skaliert – das ist der
   * einzige Ort, an dem Gegner-Impulse entstehen, damit gilt der Faktor für jeden Wegstoß-Effekt.
   */
  addRecoil(playerId: string, vx: number, vy: number, durationMs = 180, sourcePlayerId?: string): void {
    const knockbackFactor = this.enemyManager?.getEnemy(playerId)?.getKnockbackFactor() ?? 1;
    if (knockbackFactor <= 0) return;

    const startMs = Date.now();
    const impulses = this.pendingRecoils.get(playerId) ?? [];
    impulses.push({ vx: vx * knockbackFactor, vy: vy * knockbackFactor, startMs, durationMs, sourcePlayerId });
    this.pendingRecoils.set(playerId, impulses);
    if (sourcePlayerId) {
      this.recentImpulseSources.set(playerId, {
        sourcePlayerId,
        expiresAt: startMs + durationMs + TRAIN.PLAYER_PUSH_KILL_CREDIT_GRACE_MS,
      });
    }
  }

  getRecentImpulseSource(playerId: string, now = Date.now()): string | null {
    const recent = this.recentImpulseSources.get(playerId);
    if (!recent) return null;
    if (now > recent.expiresAt) {
      this.recentImpulseSources.delete(playerId);
      return null;
    }
    if (recent.sourcePlayerId === playerId) return null;
    return recent.sourcePlayerId;
  }

  setForcedMovement(playerId: string, vx: number, vy: number): void {
    this.forcedMovement.set(playerId, { vx, vy });
  }

  clearForcedMovement(playerId: string): void {
    this.forcedMovement.delete(playerId);
  }

  applyRadialImpulse(
    x: number,
    y: number,
    radius: number,
    force: number,
    ownerId?: string,
    selfMultiplier = 1,
    durationMs = 260,
  ): void {
    for (const player of this.playerManager.getAllPlayers()) {
      if (!this.combatSystem.isAlive(player.id)) continue;

      const dx = player.sprite.x - x;
      const dy = player.sprite.y - y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > radius) continue;

      const t = Phaser.Math.Clamp(dist / radius, 0, 1);
      const falloff = 1 - t;
      const mult = ownerId && player.id === ownerId ? selfMultiplier : 1;
      const impulse = force * falloff * mult;
      if (impulse <= 0) continue;

      const nx = dist > 0.001 ? dx / dist : 0;
      const ny = dist > 0.001 ? dy / dist : -1;
      this.addRecoil(player.id, nx * impulse, ny * impulse, durationMs, ownerId);
    }

    for (const enemy of this.enemyManager?.getAllEnemies() ?? []) {
      const dx = enemy.sprite.x - x;
      const dy = enemy.sprite.y - y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > radius) continue;

      const t = Phaser.Math.Clamp(dist / radius, 0, 1);
      const impulse = force * (1 - t);
      if (impulse <= 0) continue;

      const nx = dist > 0.001 ? dx / dist : 0;
      const ny = dist > 0.001 ? dy / dist : -1;
      this.addRecoil(enemy.id, nx * impulse, ny * impulse, durationMs, ownerId);
    }
  }

  private consumeImpulseVelocity(playerId: string, now: number): { vx: number; vy: number } {
    const impulses = this.pendingRecoils.get(playerId);
    if (!impulses || impulses.length === 0) return { vx: 0, vy: 0 };

    let totalVx = 0;
    let totalVy = 0;
    const remaining: ExternalImpulse[] = [];

    for (const impulse of impulses) {
      const elapsed = now - impulse.startMs;
      if (elapsed >= impulse.durationMs) continue;
      const t = elapsed / impulse.durationMs;
      const factor = (1 - t) * (1 - t);
      totalVx += impulse.vx * factor;
      totalVy += impulse.vy * factor;
      remaining.push(impulse);
    }

    if (remaining.length > 0) {
      this.pendingRecoils.set(playerId, remaining);
    } else {
      this.pendingRecoils.delete(playerId);
    }

    return { vx: totalVx, vy: totalVy };
  }

  private applyTimeBubbleFactor(
    playerId: string,
    x: number,
    y: number,
    vx: number,
    vy: number,
    now: number,
  ): { vx: number; vy: number } {
    if (this.burrowSystem?.isBurrowed(playerId)) return { vx, vy };
    const factor = this.timeBubbleSystem?.getPlayerMovementFactorAt(x, y, now, playerId) ?? 1;
    if (factor >= 0.999) return { vx, vy };
    return { vx: vx * factor, vy: vy * factor };
  }

  private applyWorldMovementFactor(
    x: number,
    y: number,
    vx: number,
    vy: number,
    now: number,
  ): { vx: number; vy: number } {
    const factor = this.timeBubbleSystem?.getPlayerMovementFactorAt(x, y, now) ?? 1;
    if (factor >= 0.999) return { vx, vy };
    return { vx: vx * factor, vy: vy * factor };
  }

  // ── Dash-Abfragen ─────────────────────────────────────────────────────────

  /** Gibt zurück ob Spieler aktuell in Phase 1 (Burst) ist → Schießen blockiert. */
  isDashBurst(id: string): boolean { return this.dashBurstPlayers.has(id); }

  /** Gibt die aktuelle Dash-Phase zurück: 0 = kein Dash, 1 = Burst, 2 = Recovery. */
  getDashPhase(id: string): 0 | 1 | 2 {
    return (this.dashStates.get(id)?.phase ?? 0) as 0 | 1 | 2;
  }

  // ── Dash-Handler (aufgerufen von NetworkBridge-RPC) ───────────────────────

  /**
   * Verarbeitet einen Dash-RPC vom Client.
   * Startet Phase 1 (Burst) mit Quad.easeOut Geschwindigkeitskurve.
   * Kein Dash wenn: tot, gestunnt, bereits dashend, oder im Stand.
   */
  handleDashRPC(playerId: string, dx: number, dy: number): void {
    if (!this.combatSystem.isAlive(playerId)) return;
    if (this.burrowSystem?.isDashBlocked(playerId)) return;
    if (this.dashStates.has(playerId)) return; // läuft noch → kein Spam

    const len = Math.sqrt(dx * dx + dy * dy);
    if (len === 0) return; // kein Dash im Stand

    const burrowSpeedFactor = this.burrowSystem?.getMovementSpeedFactor(playerId) ?? 1;
    const speedMult = this.loadoutManager?.getSpeedMultiplier(playerId) ?? 1;
    const dashRangeMultiplier = Math.max(0, this.dashRangeMultiplierResolver?.(playerId) ?? 1);
    const vNorm     = (this.runSpeedResolver?.(playerId) ?? PLAYER_SPEED) * burrowSpeedFactor * speedMult * dashRangeMultiplier;
    const player = this.playerManager.getPlayer(playerId);
    if (!player) return;

    this.dashStates.set(playerId, {
      phase:   1,
      startMs: Date.now(),
      dirX:    dx / len,
      dirY:    dy / len,
      vNorm,
      hitIds: new Set(),
      lastGroundX: player.sprite.x,
      lastGroundY: player.sprite.y,
    });
    this.dashBurstPlayers.add(playerId);
  }

  /**
   * Startet einen Gegner-Ausweichschritt in Richtung (dx, dy). Identische Mechanik zum
   * Spieler-Dash: Zweiphasen-Kurve, halbierte Trefferkugel während des Bursts. Liefert false,
   * wenn bereits ein Schritt läuft oder die Richtung leer ist.
   */
  startEnemyDash(enemyId: string, dx: number, dy: number): boolean {
    if (this.enemyDashStates.has(enemyId)) return false;
    const enemy = this.enemyManager?.getEnemy(enemyId);
    if (!enemy?.sprite.active || !this.combatSystem.isAlive(enemyId)) return false;

    const length = Math.hypot(dx, dy);
    if (length === 0) return false;

    this.enemyDashStates.set(enemyId, {
      phase:   1,
      startMs: Date.now(),
      dirX:    dx / length,
      dirY:    dy / length,
      vNorm:   enemy.getMoveSpeed(),
    });
    enemy.setDashPhase(1);
    return true;
  }

  isEnemyDashing(enemyId: string): boolean {
    return this.enemyDashStates.has(enemyId);
  }

  // ── Burrow-Kollisions-Steuerung (aufgerufen von BurrowSystem) ────────────

  /**
   * Aktiviert oder deaktiviert die Rock/Trunk-Collider für einen Spieler.
   * Wird von BurrowSystem beim Betreten/Verlassen des Burrow-Zustands aufgerufen.
   */
  setPlayerBurrowed(id: string, burrowed: boolean): void {
    if (burrowed) {
      this.burrowedPlayers.add(id);
      // Vorhandene Collider deaktivieren
      const colliders = this.playerColliders.get(id) ?? [];
      for (const c of colliders) c.active = false;
    } else {
      this.burrowedPlayers.delete(id);
      // Collider reaktivieren
      const colliders = this.playerColliders.get(id) ?? [];
      for (const c of colliders) c.active = true;
    }
  }

  /**
   * Gegenstück zu {@link setPlayerBurrowed} für Coop-Defense-Gegner. Die Collider werden lazy im
   * Frame-Update angelegt; deshalb merkt sich das Set den Zustand und {@link update} hält neu
   * erzeugte Collider eines eingebuddelten Gegners inaktiv.
   */
  setEnemyBurrowed(id: string, burrowed: boolean): void {
    if (burrowed) this.burrowedEnemies.add(id);
    else this.burrowedEnemies.delete(id);
    for (const collider of this.enemyColliders.get(id) ?? []) collider.active = !burrowed;
  }

  // ── Obstacle-Gruppen ─────────────────────────────────────────────────────

  /**
   * Setzt die Kollisions-Gruppen nach dem Arena-Aufbau.
   * Bei null (Lobby-Teardown) werden alle existierenden Collider zerstört
   * und die Tracking-Sets geleert, damit die nächste Runde sauber startet.
   */
  setRockGroup(
    rockGroup:  Phaser.Physics.Arcade.StaticGroup | null,
    trunkGroup: Phaser.Physics.Arcade.StaticGroup | null,
  ): void {
    if (rockGroup === null) {
      for (const colliders of this.playerColliders.values()) {
        for (const c of colliders) c.destroy();
      }
      for (const colliders of this.enemyColliders.values()) {
        for (const c of colliders) c.destroy();
      }
      this.playerColliders.clear();
      this.enemyColliders.clear();
      this.rockCollidersSetup.clear();
      this.trunkCollidersSetup.clear();
      this.baseCollidersSetup.clear();
      this.enemyRockCollidersSetup.clear();
      this.enemyTrunkCollidersSetup.clear();
      this.enemyBaseCollidersSetup.clear();
      this.burrowedPlayers.clear();
      this.burrowedEnemies.clear();
      this.dashStates.clear();
      this.dashBurstPlayers.clear();
      this.enemyDashStates.clear();
      this.pendingRecoils.clear();
      this.recentImpulseSources.clear();
      this.forcedMovement.clear();
    }
    this.rockGroup  = rockGroup;
    this.trunkGroup = trunkGroup;
  }

  /**
   * Setzt die Coop-Defense-Basis-Gruppe für Spieler-Kollisionen.
   * Spieler können nicht durch Basen laufen (analog zu Felsen). Wird beim
   * Teardown (null) zurückgesetzt; die Collider werden durch den rockGroup=null-
   * Pfad in setRockGroup() bereits abgeräumt.
   */
  setBaseGroup(baseGroup: Phaser.Physics.Arcade.StaticGroup | null): void {
    this.baseGroup = baseGroup;
    if (baseGroup === null) this.baseCollidersSetup.clear();
  }

  /**
   * Spieler-Collider zerstören wenn ein Spieler die Lobby verlässt.
   */
  removePlayer(id: string): void {
    const colliders = this.playerColliders.get(id);
    if (colliders) {
      for (const c of colliders) c.destroy();
      this.playerColliders.delete(id);
    }
    this.rockCollidersSetup.delete(id);
    this.trunkCollidersSetup.delete(id);
    this.baseCollidersSetup.delete(id);
    this.burrowedPlayers.delete(id);
    this.dashStates.delete(id);
    this.dashBurstPlayers.delete(id);
    this.pendingRecoils.delete(id);
    this.recentImpulseSources.delete(id);
    this.forcedMovement.delete(id);
  }

  removeEnemy(id: string): void {
    const colliders = this.enemyColliders.get(id);
    if (colliders) {
      for (const c of colliders) c.destroy();
      this.enemyColliders.delete(id);
    }
    this.enemyRockCollidersSetup.delete(id);
    this.enemyTrunkCollidersSetup.delete(id);
    this.enemyBaseCollidersSetup.delete(id);
    this.burrowedEnemies.delete(id);
    this.pendingRecoils.delete(id);
    this.recentImpulseSources.delete(id);
    this.forcedMovement.delete(id);
  }

  // ── Frame-Update ─────────────────────────────────────────────────────────

  /**
   * Jeden Frame – nur auf dem Host aktiv.
   * Priorität: Stun > Dash (2-Phasen) > Burrow-Speed > Normale Bewegung.
   */
  update(movementLocked = false): void {
    if (!this.bridge.isHost()) return;

    const now = Date.now();

    for (const enemyId of [...this.enemyColliders.keys()]) {
      if (this.enemyManager?.hasEnemy(enemyId)) continue;
      this.removeEnemy(enemyId);
    }

    for (const player of this.playerManager.getAllPlayers()) {
      // Entity kann während Round-/Scene-Teardown noch im Manager stehen,
      // obwohl Phaser den Sprite bzw. dessen Arcade-Body bereits entfernt hat.
      const playerBody = player.sprite.body as Phaser.Physics.Arcade.Body | null;
      if (!player.sprite.active || !playerBody) continue;

      // Lazy: Collider mit Felsen anlegen
      if (this.rockGroup && !this.rockCollidersSetup.has(player.id)) {
        const existing = this.playerColliders.get(player.id) ?? [];
        const c = this.scene.physics.add.collider(player.sprite, this.rockGroup);
        // Wenn Spieler bereits burrowed ist → sofort deaktivieren
        if (this.burrowedPlayers.has(player.id)) c.active = false;
        existing.push(c);
        this.playerColliders.set(player.id, existing);
        this.rockCollidersSetup.add(player.id);
      }

      // Lazy: Collider mit Baumstümpfen anlegen
      if (this.trunkGroup && !this.trunkCollidersSetup.has(player.id)) {
        const existing = this.playerColliders.get(player.id) ?? [];
        const c = this.scene.physics.add.collider(player.sprite, this.trunkGroup);
        if (this.burrowedPlayers.has(player.id)) c.active = false;
        existing.push(c);
        this.playerColliders.set(player.id, existing);
        this.trunkCollidersSetup.add(player.id);
      }

      // Lazy: Collider mit Coop-Defense-Basen anlegen
      if (this.baseGroup && !this.baseCollidersSetup.has(player.id)) {
        const existing = this.playerColliders.get(player.id) ?? [];
        const c = this.scene.physics.add.collider(player.sprite, this.baseGroup);
        if (this.burrowedPlayers.has(player.id)) c.active = false;
        existing.push(c);
        this.playerColliders.set(player.id, existing);
        this.baseCollidersSetup.add(player.id);
      }

      // Tote Spieler überspringen (body.enable = false durch CombatSystem)
      if (!this.combatSystem.isAlive(player.id)) continue;

      const impulse = this.consumeImpulseVelocity(player.id, now);
      const forcedMovement = this.forcedMovement.get(player.id);

      if (movementLocked) {
        const slowed = this.applyTimeBubbleFactor(player.id, player.sprite.x, player.sprite.y, impulse.vx, impulse.vy, now);
        playerBody.setVelocity(slowed.vx, slowed.vy);
        continue;
      }

      if (forcedMovement) {
        const slowed = this.applyTimeBubbleFactor(
          player.id,
          player.sprite.x,
          player.sprite.y,
          forcedMovement.vx + impulse.vx,
          forcedMovement.vy + impulse.vy,
          now,
        );
        playerBody.setVelocity(slowed.vx, slowed.vy);
        continue;
      }

      // ── 1. Stun: Keine Bewegung ───────────────────────────────────────
      if (this.burrowSystem?.isStunned(player.id)) {
        const slowed = this.applyTimeBubbleFactor(player.id, player.sprite.x, player.sprite.y, impulse.vx, impulse.vy, now);
        playerBody.setVelocity(slowed.vx, slowed.vy);
        continue;
      }

      let baseVx = 0;
      let baseVy = 0;

      // ── 2. Dash: 2-Phasen Speed-Debt-Modell ─────────────────────────
      const dash = this.dashStates.get(player.id);
      if (dash) {
        const elapsed = (now - dash.startMs) / 1000;

        // Air Control: WASD wenn gedrückt, sonst gespeicherte Startrichtung
        const input  = this.bridge.getPlayerInput(player.id);
        const rawX   = input?.dx ?? 0;
        const rawY   = input?.dy ?? 0;
        const rawLen = Math.sqrt(rawX * rawX + rawY * rawY);
        const dirX   = rawLen > 0 ? rawX / rawLen : dash.dirX;
        const dirY   = rawLen > 0 ? rawY / rawLen : dash.dirY;

        let speedFactor: number;
        let done = false;

        if (dash.phase === 1) {
          const timing = getDashBurstTiming(
            elapsed,
            DASH_T1_S,
            this.dashHoldEnabledResolver?.(player.id) ?? false,
            input?.dashHeld === true,
            DASH_HOLD_MAX_DURATION_FACTOR,
          );
          const t = timing.progress;
          // Quad.easeOut: sofortiger Abfall von f_start auf f_min
          const easeOut = 1 - (1 - t) * (1 - t);
          speedFactor = DASH_F_START + (DASH_F_MIN - DASH_F_START) * easeOut;

          // Hitbox sofort auf 50 % Radius (25 % Fläche)
          player.body.setCircle(PLAYER_SIZE * 0.25);
          player.sprite.setScale(0.5);
          const groundFireDurationMs = this.dashGroundFireDurationResolver?.(player.id) ?? 0;
          if (groundFireDurationMs > 0) {
            this.dashGroundFireHandler?.(
              player.id,
              `dash:${player.id}:${dash.startMs}`,
              dash.lastGroundX,
              dash.lastGroundY,
              player.sprite.x,
              player.sprite.y,
              groundFireDurationMs,
              now,
            );
            dash.lastGroundX = player.sprite.x;
            dash.lastGroundY = player.sprite.y;
          }
          const impactDamage = this.dashImpactDamageResolver?.(player.id) ?? 0;
          const impactKnockback = this.dashImpactKnockbackResolver?.(player.id) ?? 0;
          if (impactDamage > 0) {
            for (const enemy of this.enemyManager?.getAllEnemies() ?? []) {
              if (dash.hitIds.has(enemy.id) || !enemy.sprite.active) continue;
              if (Phaser.Math.Distance.Between(player.sprite.x, player.sprite.y, enemy.sprite.x, enemy.sprite.y) > PLAYER_SIZE) continue;
              dash.hitIds.add(enemy.id);
              this.combatSystem.applyDamage(enemy.id, impactDamage, false, player.id, 'Dash-Aufprall', { sourceX: player.sprite.x, sourceY: player.sprite.y });
              this.addRecoil(enemy.id, dirX * impactKnockback, dirY * impactKnockback, 180, player.id);
            }
          }

          if (timing.shouldEnd) {
            // Phase 2 beginnt bei Loslassen bzw. am normalen/erweiterten Zeitlimit neu.
            dash.phase   = 2;
            dash.startMs = now;
            this.dashBurstPlayers.delete(player.id);
          }
        } else {
          const recoveryDuration = Math.max(0.01, this.dashRecoveryDurationResolver?.(player.id) ?? DASH_T2_S);
          const t = Math.min(1, elapsed / recoveryDuration);
          // Quad.easeIn: zähes Aufrappeln von f_min auf 1.0
          const easeIn = t * t;
          speedFactor = DASH_F_MIN + (1 - DASH_F_MIN) * easeIn;
          const scale = 0.5 + 0.5 * easeIn;
          player.body.setCircle(PLAYER_SIZE * scale / 2);
          player.sprite.setScale(scale);

          if (elapsed >= recoveryDuration) {
            done = true;
            this.dashStates.delete(player.id);
            player.body.setCircle(PLAYER_SIZE / 2);
            player.sprite.setScale(1.0);
          }
        }

        if (!done) {
          baseVx = dirX * dash.vNorm * speedFactor;
          baseVy = dirY * dash.vNorm * speedFactor;
          const slowed = this.applyTimeBubbleFactor(
            player.id,
            player.sprite.x,
            player.sprite.y,
            baseVx + impulse.vx,
            baseVy + impulse.vy,
            now,
          );
          playerBody.setVelocity(slowed.vx, slowed.vy);
          continue;
        }
        // done → fällt durch zur normalen Bewegung
      }

      // ── 3. Normaler Input mit optionalem Burrow-Speed-Faktor ─────────
      const input = this.bridge.getPlayerInput(player.id);
      const dx    = input?.dx ?? 0;
      const dy    = input?.dy ?? 0;
      const len   = Math.sqrt(dx * dx + dy * dy);

      const burrowSpeedFactor = this.burrowSystem?.getMovementSpeedFactor(player.id) ?? 1;
      const speedMult  = this.loadoutManager?.getSpeedMultiplier(player.id) ?? 1;
      const speed      = (this.runSpeedResolver?.(player.id) ?? PLAYER_SPEED) * burrowSpeedFactor * speedMult;

      if (len > 0) {
        baseVx = (dx / len) * speed;
        baseVy = (dy / len) * speed;
      } else {
        baseVx = 0;
        baseVy = 0;
      }

      const selfPush = this.loadoutManager?.getHeldSelfPushVelocity(player.id);
      if (selfPush) {
        baseVx += selfPush.vx;
        baseVy += selfPush.vy;
      }

      const slowed = this.applyTimeBubbleFactor(
        player.id,
        player.sprite.x,
        player.sprite.y,
        baseVx + impulse.vx,
        baseVy + impulse.vy,
        now,
      );
      playerBody.setVelocity(slowed.vx, slowed.vy);
    }

    for (const enemy of this.enemyManager?.getAllEnemies() ?? []) {
      const enemyBody = enemy.sprite.body as Phaser.Physics.Arcade.Body | null;
      if (!enemy.sprite.active || !enemyBody) continue;

      if (this.rockGroup && !this.enemyRockCollidersSetup.has(enemy.id)) {
        const existing = this.enemyColliders.get(enemy.id) ?? [];
        existing.push(this.scene.physics.add.collider(enemy.sprite, this.rockGroup, (_enemy, rockObject) => {
          const rock = rockObject as Phaser.GameObjects.Image;
          if (!rock.active) return;
          this.enemyRockContactCallback?.(enemy.id, rock, Date.now());
        }));
        this.enemyColliders.set(enemy.id, existing);
        this.enemyRockCollidersSetup.add(enemy.id);
      }

      if (this.trunkGroup && !this.enemyTrunkCollidersSetup.has(enemy.id)) {
        const existing = this.enemyColliders.get(enemy.id) ?? [];
        existing.push(this.scene.physics.add.collider(enemy.sprite, this.trunkGroup));
        this.enemyColliders.set(enemy.id, existing);
        this.enemyTrunkCollidersSetup.add(enemy.id);
      }

      if (this.baseGroup && !this.enemyBaseCollidersSetup.has(enemy.id)) {
        const existing = this.enemyColliders.get(enemy.id) ?? [];
        existing.push(this.scene.physics.add.collider(enemy.sprite, this.baseGroup));
        this.enemyColliders.set(enemy.id, existing);
        this.enemyBaseCollidersSetup.add(enemy.id);
      }

      // Eingebuddelte Gegner kollidieren mit nichts – auch nicht mit erst hier lazy erzeugten Collidern.
      if (this.burrowedEnemies.has(enemy.id)) {
        for (const collider of this.enemyColliders.get(enemy.id) ?? []) collider.active = false;
      }

      const impulse = this.consumeImpulseVelocity(enemy.id, now);
      const dashVelocity = this.advanceEnemyDash(enemy, now);
      const desiredVelocity = dashVelocity ?? enemy.getDesiredVelocity();
      const slowed = this.applyWorldMovementFactor(
        enemy.sprite.x,
        enemy.sprite.y,
        desiredVelocity.vx + impulse.vx,
        desiredVelocity.vy + impulse.vy,
        now,
      );
      const enemyMovementFactor = Phaser.Math.Clamp(this.enemyMovementFactorResolver?.(enemy.id, now) ?? 1, 0, 1);
      enemyBody.setVelocity(slowed.vx * enemyMovementFactor, slowed.vy * enemyMovementFactor);
      enemy.syncBar();
    }

    // Stirbt ein Gegner mitten im Ausweichschritt, bleibt sein Eintrag sonst bis zum Rundenende liegen.
    for (const enemyId of this.enemyDashStates.keys()) {
      if (!this.enemyManager?.hasEnemy(enemyId)) this.enemyDashStates.delete(enemyId);
    }
  }

  /**
   * Schreibt einen laufenden Gegner-Ausweichschritt fort und liefert dessen Wunschgeschwindigkeit;
   * null, wenn kein Schritt läuft (dann gilt die normale Wegfindung).
   *
   * Bewusst identisch zum Spieler-Dash in {@link update}: Phase 1 fällt per Quad.easeOut von
   * DASH_F_START auf DASH_F_MIN und halbiert die Trefferkugel, Phase 2 rappelt sich per
   * Quad.easeIn auf 1.0 zurück. Ohne Air-Control und ohne Upgrade-Resolver – Standard-Dash.
   */
  private advanceEnemyDash(enemy: EnemyEntity, now: number): { vx: number; vy: number } | null {
    const dash = this.enemyDashStates.get(enemy.id);
    if (!dash) return null;

    // Unter der Erde bzw. im Tod bricht der Schritt sofort ab, damit die Hitbox nicht klein bleibt.
    if (enemy.isBurrowed() || !this.combatSystem.isAlive(enemy.id)) {
      this.endEnemyDash(enemy);
      return null;
    }

    const elapsed = (now - dash.startMs) / 1000;
    let speedFactor: number;

    if (dash.phase === 1) {
      const timing = getDashBurstTiming(elapsed, DASH_T1_S, false, false, DASH_HOLD_MAX_DURATION_FACTOR);
      const easeOut = 1 - (1 - timing.progress) * (1 - timing.progress);
      speedFactor = DASH_F_START + (DASH_F_MIN - DASH_F_START) * easeOut;
      enemy.setDashScale(0.5);

      if (timing.shouldEnd) {
        dash.phase = 2;
        dash.startMs = now;
        enemy.setDashPhase(2);
      }
    } else {
      const t = Math.min(1, elapsed / DASH_T2_S);
      const easeIn = t * t;
      speedFactor = DASH_F_MIN + (1 - DASH_F_MIN) * easeIn;
      enemy.setDashScale(0.5 + 0.5 * easeIn);

      if (elapsed >= DASH_T2_S) {
        this.endEnemyDash(enemy);
        return null;
      }
    }

    return { vx: dash.dirX * dash.vNorm * speedFactor, vy: dash.dirY * dash.vNorm * speedFactor };
  }

  private endEnemyDash(enemy: EnemyEntity): void {
    this.enemyDashStates.delete(enemy.id);
    enemy.setDashPhase(0);
    enemy.setDashScale(1);
  }
}
