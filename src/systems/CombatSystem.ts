import Phaser from 'phaser';
import type { PlayerManager }     from '../entities/PlayerManager';
import type { ProjectileManager } from '../entities/ProjectileManager';
import type { NetworkBridge }     from '../network/NetworkBridge';
import type { ResourceSystem }    from './ResourceSystem';
import type { DetonationSystem }  from './DetonationSystem';
import type { SyncedHitscanTrace, SyncedMeleeSwing, DetonatorConfig } from '../types';
import {
  ARENA_HEIGHT,
  HP_MAX, RESPAWN_DELAY_MS,
  ARENA_OFFSET_X, ARENA_OFFSET_Y,
  ARENA_WIDTH,
  HITSCAN_FAVOR_THE_SHOOTER_MAX_OFFSET,
  HITSCAN_FAVOR_THE_SHOOTER_MS,
  PLAYER_SIZE,
  RAGE_PER_DAMAGE, ADRENALINE_START,
} from '../config';

// Hitscan-Traces und Melee-Swings werden jetzt per RPC statt State gesendet

// Zirkuläre Abhängigkeiten vermeiden: nur Typ-Imports
type BurrowSystemType    = { isBurrowed(id: string): boolean };
type LoadoutManagerType  = { getDamageMultiplier(id: string): number };
type PowerUpSystemType   = { getDamageMultiplier(id: string): number; removePlayer(id: string): void };

export interface HitscanTraceResult {
  readonly endX: number;
  readonly endY: number;
  readonly distance: number;
  readonly hitPlayerId: string | null;
}

export interface HitscanTraceOptions {
  readonly shooterId: string;
  readonly startX: number;
  readonly startY: number;
  readonly angle: number;
  readonly range: number;
  readonly traceThickness: number;
  readonly applyFavorTheShooter: boolean;
}

export class CombatSystem {
  private hp:            Map<string, number>                           = new Map();
  private alive:         Map<string, boolean>                          = new Map();
  private respawnTimers: Map<string, ReturnType<typeof setTimeout>>    = new Map();
  private readonly hitscanLine = new Phaser.Geom.Line();
  private readonly meleeLine   = new Phaser.Geom.Line();  // Scratch-Linie für Melee-Hindernisprüfung
  private readonly arenaBounds = new Phaser.Geom.Rectangle(ARENA_OFFSET_X, ARENA_OFFSET_Y, ARENA_WIDTH, ARENA_HEIGHT);
  private readonly scratchCircle = new Phaser.Geom.Circle();
  private readonly scratchPoints: Phaser.Geom.Point[] = [];
  private meleeSwingIdCounter = 0;

  // Kill-Tracking: letzter Angreifer & Waffe pro Ziel (für Frag-Vergabe)
  private lastAttacker: Map<string, string> = new Map();  // victimId → attackerId
  private lastWeapon:   Map<string, string> = new Map();  // victimId → weaponName

  // Callback: (killerId, victimId, weaponName) – Host-only
  private onKillCb: ((killerId: string, victimId: string, weapon: string, x: number, y: number) => void) | null = null;

  // Optionale Referenzen – werden nach Konstruktion gesetzt
  private burrowSystem:     BurrowSystemType    | null  = null;
  private resourceSystem:   ResourceSystem      | null  = null;
  private loadoutManager:   LoadoutManagerType  | null  = null;
  private powerUpSystem:    PowerUpSystemType   | null  = null;
  private detonationSystem: DetonationSystem    | null  = null;
  private rockObjects: readonly (Phaser.GameObjects.Image | null)[] | null = null;
  private trunkObjects: readonly Phaser.GameObjects.Arc[] | null = null;
  private trainSegObjects: readonly Phaser.GameObjects.Rectangle[] | null = null;

  // Callbacks für Objekt-Schaden (gesetzt von ArenaScene)
  private onRockDamage:  ((rockIndex: number, damage: number) => void) | null = null;
  private onTrainDamage: ((damage: number, attackerId: string) => void) | null = null;

  constructor(
    private playerManager:     PlayerManager,
    private projectileManager: ProjectileManager,
    private bridge:            NetworkBridge,
  ) {}

  // ── Referenz-Injection ────────────────────────────────────────────────────

  setBurrowSystem(bs: BurrowSystemType | null): void     { this.burrowSystem   = bs; }
  setResourceSystem(rs: ResourceSystem | null): void     { this.resourceSystem = rs; }
  setLoadoutManager(lm: LoadoutManagerType | null): void { this.loadoutManager = lm; }
  setPowerUpSystem(ps: PowerUpSystemType | null): void   { this.powerUpSystem  = ps; }
  setDetonationSystem(ds: DetonationSystem | null): void { this.detonationSystem = ds; }
  setArenaObstacles(
    rockObjects: readonly (Phaser.GameObjects.Image | null)[] | null,
    trunkObjects: readonly Phaser.GameObjects.Arc[] | null,
  ): void {
    this.rockObjects = rockObjects;
    this.trunkObjects = trunkObjects;
  }

  setTrainSegments(segments: readonly Phaser.GameObjects.Rectangle[] | null): void {
    this.trainSegObjects = segments;
  }

  setRockDamageCallback(cb: ((rockIndex: number, damage: number) => void) | null): void {
    this.onRockDamage = cb;
  }

  setTrainDamageCallback(cb: ((damage: number, attackerId: string) => void) | null): void {
    this.onTrainDamage = cb;
  }

  /** Setzt den Kill-Callback (Host-only). */
  setKillCallback(cb: (killerId: string, victimId: string, weapon: string, x: number, y: number) => void): void {
    this.onKillCb = cb;
  }

  // ── Spieler-Lifecycle ──────────────────────────────────────────────────────

  initPlayer(id: string): void {
    this.hp.set(id, HP_MAX);
    this.alive.set(id, true);
    this.lastAttacker.delete(id);
    this.lastWeapon.delete(id);
  }

  removePlayer(id: string): void {
    this.hp.delete(id);
    this.alive.delete(id);
    this.lastAttacker.delete(id);
    this.lastWeapon.delete(id);
    const t = this.respawnTimers.get(id);
    if (t) { clearTimeout(t); this.respawnTimers.delete(id); }
  }

  // ── Abfragen ───────────────────────────────────────────────────────────────

  getHP(id: string):    number  { return this.hp.get(id)    ?? HP_MAX; }
  isAlive(id: string):  boolean { return this.alive.get(id) ?? false;  }

  // ── Öffentliche Schadens-Methode ───────────────────────────────────────────

  /**
   * Fügt einem Spieler Schaden zu. Burrowed-Spieler sind unverwundbar
   * (Ausnahme: Stuck-Schaden über skipBurrowCheck=true).
   * attackerId/weaponName werden für die Kill-Zuordnung getrackt.
   */
  applyDamage(
    targetId:        string,
    amount:          number,
    skipBurrowCheck  = false,
    attackerId?:     string,
    weaponName?:     string,
  ): void {
    if (!this.isAlive(targetId)) return;
    if (!skipBurrowCheck && this.burrowSystem?.isBurrowed(targetId)) return;

    // Letzten Angreifer tracken (Selbstschaden ausgenommen)
    if (attackerId && attackerId !== targetId) {
      this.lastAttacker.set(targetId, attackerId);
      if (weaponName) this.lastWeapon.set(targetId, weaponName);
    }

    const player = this.playerManager.getPlayer(targetId);
    const x = player?.sprite.x ?? 0;
    const y = player?.sprite.y ?? 0;

    const newHp = Math.max(0, (this.hp.get(targetId) ?? HP_MAX) - amount);
    this.hp.set(targetId, newHp);

    // Wut-Gewinn proportional zum Schaden
    this.resourceSystem?.addRage(targetId, amount * RAGE_PER_DAMAGE);

    this.bridge.broadcastEffect('hit', x, y, attackerId);

    if (newHp === 0) this.handleDeath(targetId, x, y);
  }

  /**
   * Flächenschaden um einen Punkt (z.B. Granaten-Explosion).
   * Burrowed-Spieler sind immun (skipBurrowCheck=false).
   */
  applyAoeDamage(
    x: number,
    y: number,
    radius: number,
    damage: number,
    ownerId: string,
    includeSelf = false,
  ): void {
    for (const player of this.playerManager.getAllPlayers()) {
      if (!includeSelf && player.id === ownerId) continue;
      if (!this.isAlive(player.id)) continue;
      const dist = Phaser.Math.Distance.Between(x, y, player.sprite.x, player.sprite.y);
      if (dist <= radius) {
        this.applyDamage(player.id, damage, false, ownerId, 'Granate');
      }
    }
  }

  // ── Host-Update: Projektil-Spieler-Kollisionserkennung ────────────────────

  /**
   * Jeden Frame auf dem Host aufrufen.
   * Prüft Überschneidungen zwischen Projektilen und Spielern.
   * Selbst-Treffer, Granaten und burrowed Spieler werden ignoriert.
   */
  update(): void {
    if (!this.bridge.isHost()) return;

    for (const proj of this.projectileManager.getActiveProjectiles()) {
      if (proj.isGrenade) continue;  // Granaten treffen nicht direkt, nur AoE
      const projBounds = proj.sprite.getBounds();

      for (const player of this.playerManager.getAllPlayers()) {
        if (!this.isAlive(player.id))                     continue;
        if (proj.ownerId === player.id)                   continue;
        if (this.burrowSystem?.isBurrowed(player.id))     continue;

        if (Phaser.Geom.Intersects.RectangleToRectangle(projBounds, player.sprite.getBounds())) {
          // Damage-Multiplier des Schützen (Ultimate + PowerUp)
          const loadoutMult  = this.loadoutManager?.getDamageMultiplier(proj.ownerId) ?? 1;
          const powerUpMult  = this.powerUpSystem?.getDamageMultiplier(proj.ownerId) ?? 1;
          const actualDamage = proj.damage * loadoutMult * powerUpMult;

          if (proj.isBfg) {
            // BFG: Piercing – Spieler nur 1x treffen, Projektil fliegt weiter
            if (!proj.bfgHitPlayers) proj.bfgHitPlayers = new Set();
            if (proj.bfgHitPlayers.has(player.id)) continue;
            proj.bfgHitPlayers.add(player.id);
            this.applyDamage(player.id, actualDamage, false, proj.ownerId, proj.weaponName);
            continue; // kein break, kein destroyProjectile
          }

          this.handleHit(proj.id, player.id, actualDamage, proj.ownerId, proj.adrenalinGain, proj.weaponName);
          break;  // Projektil trifft maximal einen Spieler pro Frame
        }
      }
    }
  }

  resolveHitscanShot(
    shooterId: string,
    startX: number,
    startY: number,
    angle: number,
    range: number,
    damage: number,
    traceThickness: number,
    playerColor: number,
    adrenalinGain: number,
    weaponName: string,
    shotId?: number,
    detonatorCfg?: DetonatorConfig,
    rockDamageMult = 1,
    trainDamageMult = 1,
  ): boolean {
    if (!this.bridge.isHost()) return false;

    const trace = this.traceHitscan({
      shooterId,
      startX,
      startY,
      angle,
      range,
      traceThickness,
      applyFavorTheShooter: true,
    });

    this.queueHitscanTrace({
      startX: Math.round(startX),
      startY: Math.round(startY),
      endX: Math.round(trace.endX),
      endY: Math.round(trace.endY),
      color: playerColor,
      thickness: traceThickness,
      shooterId,
      shotId,
    });

    // Hitscan-Detonation prüfen (z.B. ASMD Primary zündet ASMD Secondary-Ball)
    if (detonatorCfg) {
      this.detonationSystem?.checkHitscanDetonations(
        startX, startY, trace.endX, trace.endY, shooterId, detonatorCfg,
      );
    }

    if (trace.hitPlayerId) {
      const loadoutMult  = this.loadoutManager?.getDamageMultiplier(shooterId) ?? 1;
      const powerUpMult  = this.powerUpSystem?.getDamageMultiplier(shooterId) ?? 1;
      const actualDamage = damage * loadoutMult * powerUpMult;
      this.applyDamage(trace.hitPlayerId, actualDamage, true, shooterId, weaponName);

      if (adrenalinGain > 0) {
        this.resourceSystem?.addAdrenaline(shooterId, adrenalinGain);
      }
    } else {
      // Kein Spieler getroffen → prüfen ob Fels oder Zug getroffen wurde
      this.applyHitscanObjectDamage(
        startX, startY, trace.endX, trace.endY,
        damage, rockDamageMult, trainDamageMult, shooterId,
      );
    }

    return true;
  }

  /**
   * Prüft, ob der Hitscan-Endpunkt einen Fels oder Zug trifft, und wendet Schaden an.
   */
  private applyHitscanObjectDamage(
    startX: number, startY: number, endX: number, endY: number,
    damage: number, rockMult: number, trainMult: number, shooterId: string,
  ): void {
    const hitLine = new Phaser.Geom.Line(startX, startY, endX, endY);
    const endDist = Phaser.Geom.Line.Length(hitLine);
    const EPSILON = 2; // Toleranz in px

    // Nächsten Fels am Endpunkt suchen
    if (rockMult !== 0 && this.rockObjects && this.onRockDamage) {
      let bestRockIdx = -1;
      let bestRockDist = Infinity;
      for (let i = 0; i < this.rockObjects.length; i++) {
        const rock = this.rockObjects[i];
        if (!rock?.active) continue;
        const hit = this.findNearestRectangleHit(hitLine, rock.getBounds());
        if (hit && Math.abs(hit.distance - endDist) < EPSILON && hit.distance < bestRockDist) {
          bestRockDist = hit.distance;
          bestRockIdx = i;
        }
      }
      if (bestRockIdx >= 0) {
        this.onRockDamage(bestRockIdx, damage * rockMult);
        return; // Fels blockiert – kein Zug dahinter
      }
    }

    // Zug-Segment am Endpunkt suchen
    if (trainMult !== 0 && this.trainSegObjects && this.onTrainDamage) {
      for (const seg of this.trainSegObjects) {
        if (!seg.active) continue;
        const hit = this.findNearestRectangleHit(hitLine, seg.getBounds());
        if (hit && Math.abs(hit.distance - endDist) < EPSILON) {
          this.onTrainDamage(damage * trainMult, shooterId);
          return;
        }
      }
    }
  }

  // collectReplicatedHitscanTraces entfernt – Traces werden per RPC gesendet

  // ── Melee-Angriff ─────────────────────────────────────────────────────────

  /**
   * Löst einen Melee-Angriff aus.
   * Trifft ALLE Gegner, die sich im Trefferbereich befinden (Fächerform).
   * Hindernisse (Felsen, Baumstämme) blockieren den Angriff auf dahinter stehende Ziele.
   * Gibt true zurück wenn der Angriff verarbeitet wurde (Host-only).
   */
  resolveMeleeSwing(
    shooterId:     string,
    x:             number,
    y:             number,
    angle:         number,
    range:         number,
    arcDegrees:    number,
    damage:        number,
    adrenalinGain: number,
    weaponName:    string,
    playerColor:   number,
    rockDamageMult  = 1,
    trainDamageMult = 1,
  ): boolean {
    if (!this.bridge.isHost()) return false;

    const halfArcRad = (arcDegrees * Math.PI / 180) / 2;

    for (const player of this.playerManager.getAllPlayers()) {
      if (!this.isMeleeTargetCandidate(player.id, shooterId)) continue;

      const dx   = player.sprite.x - x;
      const dy   = player.sprite.y - y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      // Reichweite – Spieler-Radius als Toleranz hinzurechnen
      if (dist > range + PLAYER_SIZE * 0.5) continue;

      // Winkelprüfung: liegt das Ziel innerhalb des Trefferbogens?
      let angleDiff = Math.atan2(dy, dx) - angle;
      while (angleDiff >  Math.PI) angleDiff -= 2 * Math.PI;
      while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;
      if (Math.abs(angleDiff) > halfArcRad) continue;

      // Hindernischeck: liegt ein Fels/Stamm zwischen Schütze und Ziel?
      this.meleeLine.setTo(x, y, player.sprite.x, player.sprite.y);
      if (this.isMeleePathBlocked(dist - PLAYER_SIZE * 0.5)) continue;

      const loadoutMult  = this.loadoutManager?.getDamageMultiplier(shooterId) ?? 1;
      const powerUpMult  = this.powerUpSystem?.getDamageMultiplier(shooterId) ?? 1;
      const actualDamage = damage * loadoutMult * powerUpMult;
      this.applyDamage(player.id, actualDamage, true, shooterId, weaponName);

      if (adrenalinGain > 0) {
        this.resourceSystem?.addAdrenaline(shooterId, adrenalinGain);
      }
    }

    // Melee-Objektschaden: Felsen und Zug im Trefferbogen prüfen
    this.applyMeleeObjectDamage(x, y, angle, range, halfArcRad, damage, rockDamageMult, trainDamageMult, shooterId);

    // Swing-VFX für alle Clients in die Replikations-Queue einreihen
    this.queueMeleeSwing({ x, y, angle, arcDegrees, range, color: playerColor, shooterId });
    return true;
  }

  // collectReplicatedMeleeSwings entfernt – Swings werden per RPC gesendet

  /**
   * Prüft, ob Felsen oder Zug-Segmente im Melee-Trefferbogen liegen, und wendet Schaden an.
   */
  private applyMeleeObjectDamage(
    x: number, y: number, angle: number, range: number, halfArcRad: number,
    damage: number, rockMult: number, trainMult: number, shooterId: string,
  ): void {
    // Felsschaden
    if (rockMult !== 0 && this.rockObjects && this.onRockDamage) {
      for (let i = 0; i < this.rockObjects.length; i++) {
        const rock = this.rockObjects[i];
        if (!rock?.active) continue;
        const dx   = rock.x - x;
        const dy   = rock.y - y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > range) continue;
        let ad = Math.atan2(dy, dx) - angle;
        while (ad >  Math.PI) ad -= 2 * Math.PI;
        while (ad < -Math.PI) ad += 2 * Math.PI;
        if (Math.abs(ad) > halfArcRad) continue;
        this.onRockDamage(i, damage * rockMult);
      }
    }

    // Zugschaden
    if (trainMult !== 0 && this.trainSegObjects && this.onTrainDamage) {
      for (const seg of this.trainSegObjects) {
        if (!seg.active) continue;
        const dx   = seg.x - x;
        const dy   = seg.y - y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > range) continue;
        let ad = Math.atan2(dy, dx) - angle;
        while (ad >  Math.PI) ad -= 2 * Math.PI;
        while (ad < -Math.PI) ad += 2 * Math.PI;
        if (Math.abs(ad) > halfArcRad) continue;
        this.onTrainDamage(damage * trainMult, shooterId);
        break; // Nur einmal pro Swing den Zug treffen
      }
    }
  }

  traceHitscan(options: HitscanTraceOptions): HitscanTraceResult {
    const { shooterId, startX, startY, angle, range, traceThickness, applyFavorTheShooter } = options;

    const dirX = Math.cos(angle);
    const dirY = Math.sin(angle);
    const maxEndX = startX + dirX * range;
    const maxEndY = startY + dirY * range;
    this.hitscanLine.setTo(startX, startY, maxEndX, maxEndY);

    let closestDistance = Phaser.Geom.Line.Length(this.hitscanLine);
    const obstacleHit = this.findNearestObstacleHit(this.hitscanLine);
    if (obstacleHit) closestDistance = obstacleHit.distance;

    let hitPlayerId: string | null = null;
    for (const player of this.playerManager.getAllPlayers()) {
      if (!this.isHitscanTargetCandidate(player.id, shooterId)) continue;

      const hitDistance = this.getHitscanPlayerHitDistance(
        this.hitscanLine,
        player,
        traceThickness,
        applyFavorTheShooter,
      );
      if (hitDistance === null || hitDistance > closestDistance) continue;

      closestDistance = hitDistance;
      hitPlayerId = player.id;
    }

    return {
      endX: startX + dirX * closestDistance,
      endY: startY + dirY * closestDistance,
      distance: closestDistance,
      hitPlayerId,
    };
  }

  // ── LoS-Check (für BFG-Laser) ──────────────────────────────────────────────

  /**
   * Prüft, ob eine direkte Sichtlinie zwischen zwei Punkten besteht.
   * Felsen und Baumstämme blockieren die Sichtlinie; Arena-Wände und Zug nicht.
   */
  hasLineOfSight(
    startX: number, startY: number,
    endX: number, endY: number,
    skipRockIndex?: number,
  ): boolean {
    const line = new Phaser.Geom.Line(startX, startY, endX, endY);
    const targetDist = Phaser.Geom.Line.Length(line);

    if (this.rockObjects) {
      for (let i = 0; i < this.rockObjects.length; i++) {
        if (i === skipRockIndex) continue;
        const rock = this.rockObjects[i];
        if (!rock?.active) continue;
        const hit = this.findNearestRectangleHit(line, rock.getBounds());
        if (hit && hit.distance < targetDist - 2) return false;
      }
    }

    if (this.trunkObjects) {
      for (const trunk of this.trunkObjects) {
        if (!trunk.active) continue;
        const hit = this.findNearestCircleHit(line, trunk.x, trunk.y, trunk.radius);
        if (hit && hit.distance < targetDist - 2) return false;
      }
    }

    return true;
  }

  // ── Privat: Treffer, Tod, Respawn ──────────────────────────────────────────

  private queueHitscanTrace(trace: SyncedHitscanTrace): void {
    // Direkt per RPC an alle Clients senden (einmalig, statt per-frame in GameState)
    this.bridge.broadcastHitscanTracer(
      trace.startX, trace.startY, trace.endX, trace.endY,
      trace.color, trace.thickness, trace.shooterId, trace.shotId,
    );
    // Lokale Wiedergabe auf dem Host (EffectSystem bekommt das RPC auch)
  }

  private queueMeleeSwing(swing: Omit<SyncedMeleeSwing, 'swingId'>): void {
    const fullSwing: SyncedMeleeSwing = { ...swing, swingId: ++this.meleeSwingIdCounter };
    // Direkt per RPC an alle Clients senden
    this.bridge.broadcastMeleeSwing(fullSwing);
  }

  /**
   * Prüft, ob ein Hindernis (Fels oder Baumstamm) die aktuelle meleeLine
   * vor der angegebenen Distanz blockiert (Arena-Außenwände werden ignoriert,
   * da Ziele immer innerhalb der Arena stehen).
   */
  private isMeleePathBlocked(maxDist: number): boolean {
    if (this.rockObjects) {
      for (const rock of this.rockObjects) {
        if (!rock?.active) continue;
        const hit = this.findNearestRectangleHit(this.meleeLine, rock.getBounds());
        if (hit && hit.distance < maxDist) return true;
      }
    }
    if (this.trunkObjects) {
      for (const trunk of this.trunkObjects) {
        if (!trunk.active) continue;
        const hit = this.findNearestCircleHit(this.meleeLine, trunk.x, trunk.y, trunk.radius);
        if (hit && hit.distance < maxDist) return true;
      }
    }
    return false;
  }

  private isMeleeTargetCandidate(playerId: string, shooterId: string): boolean {
    if (playerId === shooterId) return false;
    if (!this.isAlive(playerId)) return false;
    if (this.burrowSystem?.isBurrowed(playerId)) return false;
    return true;
  }

  private isHitscanTargetCandidate(playerId: string, shooterId: string): boolean {
    if (playerId === shooterId) return false;
    if (!this.isHitscanTargetAlive(playerId)) return false;
    if (this.isHitscanTargetBurrowed(playerId)) return false;
    return true;
  }

  private isHitscanTargetAlive(playerId: string): boolean {
    if (this.bridge.isHost()) return this.isAlive(playerId);
    return this.bridge.getLatestGameState()?.players[playerId]?.alive ?? true;
  }

  private isHitscanTargetBurrowed(playerId: string): boolean {
    if (this.burrowSystem) return this.burrowSystem.isBurrowed(playerId);
    return this.bridge.getLatestGameState()?.players[playerId]?.isBurrowed ?? false;
  }

  private getHitscanPlayerHitDistance(
    line: Phaser.Geom.Line,
    player: ReturnType<PlayerManager['getAllPlayers']>[number],
    traceThickness: number,
    applyFavorTheShooter: boolean,
  ): number | null {
    if (applyFavorTheShooter) {
      return this.getFavorTheShooterHitDistance(line, player, traceThickness);
    }

    const baseRadius = PLAYER_SIZE * 0.5 + traceThickness * 0.5;
    return this.findNearestCircleHit(line, player.sprite.x, player.sprite.y, baseRadius)?.distance ?? null;
  }

  private findNearestObstacleHit(
    line: Phaser.Geom.Line,
  ): { distance: number; x: number; y: number } | null {
    let bestHit = this.findNearestRectangleHit(line, this.arenaBounds);

    if (this.rockObjects) {
      for (const rock of this.rockObjects) {
        if (!rock?.active) continue;
        const hit = this.findNearestRectangleHit(line, rock.getBounds());
        if (hit && (!bestHit || hit.distance < bestHit.distance)) bestHit = hit;
      }
    }

    if (this.trunkObjects) {
      for (const trunk of this.trunkObjects) {
        if (!trunk.active) continue;
        const hit = this.findNearestCircleHit(line, trunk.x, trunk.y, trunk.radius);
        if (hit && (!bestHit || hit.distance < bestHit.distance)) bestHit = hit;
      }
    }

    if (this.trainSegObjects) {
      for (const seg of this.trainSegObjects) {
        if (!seg.active) continue;
        const hit = this.findNearestRectangleHit(line, seg.getBounds());
        if (hit && (!bestHit || hit.distance < bestHit.distance)) bestHit = hit;
      }
    }

    return bestHit;
  }

  private getFavorTheShooterHitDistance(
    line: Phaser.Geom.Line,
    player: ReturnType<PlayerManager['getAllPlayers']>[number],
    traceThickness: number,
  ): number | null {
    const baseRadius = PLAYER_SIZE * 0.5 + traceThickness * 0.5;
    const currentHit = this.findNearestCircleHit(line, player.sprite.x, player.sprite.y, baseRadius);

    const velocity = player.body.velocity;
    const rewindX = player.sprite.x - velocity.x * (HITSCAN_FAVOR_THE_SHOOTER_MS / 1000);
    const rewindY = player.sprite.y - velocity.y * (HITSCAN_FAVOR_THE_SHOOTER_MS / 1000);
    const rewindHit = this.findNearestCircleHit(line, rewindX, rewindY, baseRadius);

    const rewindOffset = Math.min(
      HITSCAN_FAVOR_THE_SHOOTER_MAX_OFFSET,
      Phaser.Math.Distance.Between(player.sprite.x, player.sprite.y, rewindX, rewindY),
    );
    const sweepHit = this.findNearestCircleHit(
      line,
      (player.sprite.x + rewindX) * 0.5,
      (player.sprite.y + rewindY) * 0.5,
      baseRadius + rewindOffset * 0.5,
    );

    return [currentHit, rewindHit, sweepHit]
      .filter((hit): hit is { distance: number; x: number; y: number } => hit !== null)
      .reduce<number | null>((best, hit) => {
        if (best === null || hit.distance < best) return hit.distance;
        return best;
      }, null);
  }

  private findNearestRectangleHit(
    line: Phaser.Geom.Line,
    rect: Phaser.Geom.Rectangle,
  ): { distance: number; x: number; y: number } | null {
    const points = Phaser.Geom.Intersects.GetLineToRectangle(line, rect, this.scratchPoints);
    return this.pickNearestIntersection(line, points);
  }

  private findNearestCircleHit(
    line: Phaser.Geom.Line,
    centerX: number,
    centerY: number,
    radius: number,
  ): { distance: number; x: number; y: number } | null {
    this.scratchCircle.setTo(centerX, centerY, radius);
    const points = Phaser.Geom.Intersects.GetLineToCircle(line, this.scratchCircle, this.scratchPoints);
    return this.pickNearestIntersection(line, points);
  }

  private pickNearestIntersection(
    line: Phaser.Geom.Line,
    points: Phaser.Geom.Point[],
  ): { distance: number; x: number; y: number } | null {
    let bestHit: { distance: number; x: number; y: number } | null = null;

    for (const point of points) {
      const distance = Phaser.Math.Distance.Between(line.x1, line.y1, point.x, point.y);
      if (distance <= 0.01) continue;
      if (!bestHit || distance < bestHit.distance) {
        bestHit = { distance, x: point.x, y: point.y };
      }
    }

    points.length = 0;
    return bestHit;
  }

  private handleHit(
    projectileId:  number,
    playerId:      string,
    damage:        number,
    shooterId:     string,
    adrenalinGain: number,
    weaponName:    string,
  ): void {
    this.projectileManager.destroyProjectile(projectileId);
    this.applyDamage(playerId, damage, true, shooterId, weaponName);

    // Adrenalin-Belohnung für den Schützen
    if (adrenalinGain > 0) {
      this.resourceSystem?.addAdrenaline(shooterId, adrenalinGain);
    }
  }

  private handleDeath(playerId: string, x: number, y: number): void {
    this.alive.set(playerId, false);

    // Aktive Duration-Buffs (z.B. Adrenalinspritze) beim Tod entfernen
    this.powerUpSystem?.removePlayer(playerId);

    const player = this.playerManager.getPlayer(playerId);
    if (player) player.body.enable = false;

    this.bridge.broadcastEffect('death', x, y);

    // Kill-Callback auslösen (Host-only, kein Selbstkill)
    const killerId = this.lastAttacker.get(playerId);
    if (killerId && killerId !== playerId) {
      const weapon = this.lastWeapon.get(playerId) ?? 'Waffe';
      this.onKillCb?.(killerId, playerId, weapon, x, y);
    }

    const timer = setTimeout(() => this.respawn(playerId), RESPAWN_DELAY_MS);
    this.respawnTimers.set(playerId, timer);
  }

  /** Heilt den Spieler vollständig auf HP_MAX (nur wenn lebendig). */
  healToFull(playerId: string): void {
    if (!this.isAlive(playerId)) return;
    this.hp.set(playerId, HP_MAX);
  }

  private respawn(playerId: string): void {
    this.hp.set(playerId, HP_MAX);
    this.alive.set(playerId, true);
    this.respawnTimers.delete(playerId);
    this.lastAttacker.delete(playerId);
    this.lastWeapon.delete(playerId);

    this.resourceSystem?.setAdrenaline(playerId, ADRENALINE_START);

    const player = this.playerManager.getPlayer(playerId);
    if (!player) return;

    player.body.enable = true;
    const spawn = this.playerManager.getSpawnPoint();
    player.setPosition(ARENA_OFFSET_X + spawn.x, ARENA_OFFSET_Y + spawn.y);
  }
}
