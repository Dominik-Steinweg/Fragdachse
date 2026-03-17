import Phaser from 'phaser';
import {
  ARENA_OFFSET_Y, ARENA_HEIGHT, PLAYER_SIZE,
} from '../config';
import type { SyncedTrainState } from '../types';
import type { PlayerManager } from '../entities/PlayerManager';
import { TRAIN } from './TrainConfig';

// ── Öffentliche Ergebnis-Typen ────────────────────────────────────────────────

export interface TrainDestroyResult {
  /** PlayerId des letzten Treffers (null wenn unbekannt) */
  lastHitterId:      string | null;
  /** Welt-X der Gleismitte */
  centerX:           number;
  /** Welt-Y des Zugmittelpunkts zum Zerstörungszeitpunkt */
  centerY:           number;
  /** Gesamt-Pixelhöhe des Zugs inkl. Lücken */
  totalHeight:       number;
  /** Weltkoordinaten jedes Segments (Lok + Waggons) zum Zerstörungszeitpunkt */
  segmentPositions:  { x: number; y: number }[];
}

// ── TrainManager ──────────────────────────────────────────────────────────────

/**
 * Host-only: Verwaltet den fahrenden Zug RB 54.
 *
 * - Bewegung, HP, Player-Overlap-Erkennung
 * - Stellt eine `StaticGroup` für die Projektil-Kollision bereit
 *   (wird nach jeder Frame-Bewegung per `group.refresh()` aktualisiert)
 * - Liefert `getNetSnapshot()` für die Netzwerk-Synchronisation
 */
export class TrainManager {
  // ── Zustand ───────────────────────────────────────────────────────────────
  private hp: number  = TRAIN.HP_MAX;
  private alive       = false;
  private active      = false;   // true nach spawn(), false nach Verlassen der Arena / Zerstörung
  private destroyed   = false;
  private lastHitter: string | null = null;

  /** Y-Mitte der Lokomotive (ändert sich jeden Frame) */
  private locoY: number;

  /** Welt-X der Gleismitte – fest für die gesamte Runde */
  private readonly trackX: number;
  /** Fahrtrichtung: 1 = von oben nach unten, -1 = von unten nach oben */
  private direction: 1 | -1;

  // ── Phaser-Objekte ────────────────────────────────────────────────────────
  /** StaticGroup: unsichtbare Hitbox-Rechtecke, wird für Projektil-Overlap genutzt */
  private group!:       Phaser.Physics.Arcade.StaticGroup;
  /** Paralleles Array zu Lok + Waggons */
  private segObjects:   Phaser.GameObjects.Rectangle[] = [];

  // ── Callbacks ─────────────────────────────────────────────────────────────
  private onPlayerHit: ((playerId: string) => void)          | null = null;
  private onDestroyed: ((r: TrainDestroyResult) => void)     | null = null;
  private onExited:    (() => void)                          | null = null;

  constructor(
    private scene:         Phaser.Scene,
    private playerManager: PlayerManager,
    trackX:                number,
    direction:             1 | -1,
  ) {
    this.trackX    = trackX;
    this.direction = direction;
    this.locoY     = this.initialLocoY();
    this.buildGroup();
  }

  // ── Callback-Injection ───────────────────────────────────────────────────

  setPlayerHitCallback(cb: (playerId: string) => void):     void { this.onPlayerHit = cb; }
  setDestroyCallback(cb: (r: TrainDestroyResult) => void):  void { this.onDestroyed  = cb; }
  setExitedCallback(cb: () => void):                        void { this.onExited     = cb; }

  // ── Zugriff auf Physics-Gruppe ───────────────────────────────────────────

  /** Gibt die StaticGroup zurück – für Projektil-Overlap im ProjectileManager. */
  getGroup(): Phaser.Physics.Arcade.StaticGroup { return this.group; }

  /** Gibt die Segment-Rectangles zurück – für Hitscan-/Melee-Kollisionserkennung. */
  getSegObjects(): readonly Phaser.GameObjects.Rectangle[] { return this.segObjects; }

  // ── Status-Abfragen ──────────────────────────────────────────────────────

  isActive():    boolean { return this.active;    }
  isAlive():     boolean { return this.alive;     }
  isDestroyed(): boolean { return this.destroyed; }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  /** Startet den Zug (Spawn-Zeitpunkt erreicht). */
  spawn(): void {
    // hp wird absichtlich NICHT zurückgesetzt – bleibt über Durchfahrten erhalten.
    // Initialwert kommt aus dem Feldinitialisier (HP_MAX) bzw. prepareReentry() lässt ihn stehen.
    this.alive     = true;
    this.active    = true;
    this.destroyed = false;
    this.lastHitter = null;
    this.locoY     = this.initialLocoY();
    this.updateSegmentPositions();
    this.group.refresh();
    for (const s of this.segObjects) {
      s.setVisible(false); // TrainRenderer zeichnet; Hitbox-Objekte bleiben unsichtbar
      (s.body as Phaser.Physics.Arcade.StaticBody).enable = true;
    }
  }

  /**
   * Schadens-Eingang (z. B. durch Projektil).
   * Wird vom TrainHitCallback in ArenaScene aufgerufen.
   */
  applyDamage(amount: number, attackerId: string): void {
    if (!this.alive || this.destroyed) return;
    if (attackerId !== TRAIN.TRAIN_KILLER_ID) {
      this.lastHitter = attackerId;
    }
    this.hp = Math.max(0, this.hp - amount);
    if (this.hp <= 0) this.handleDestruction();
  }

  /**
   * Jeden Frame aufrufen (nur wenn aktiv, nur auf dem Host).
   * @param delta – ms seit dem letzten Frame
   */
  update(delta: number): void {
    if (!this.active || this.destroyed) return;

    this.locoY += this.direction * TRAIN.SPEED * (delta / 1000);
    this.updateSegmentPositions();
    this.group.refresh();
    this.checkPlayerOverlaps();

    if (this.hasFullyExited()) {
      this.active = false;
      this.alive  = false;
      for (const s of this.segObjects) {
        (s.body as Phaser.Physics.Arcade.StaticBody).enable = false;
      }
      this.onExited?.();
    }
  }

  /**
   * Liefert den aktuellen Netzwerk-Snapshot für GameState.train.
   * Gibt null zurück solange der Zug nicht aktiv und nicht gerade zerstört wurde.
   */
  getNetSnapshot(): SyncedTrainState | null {
    if (!this.active && !this.destroyed) return null;
    return {
      hp:    this.hp,
      maxHp: TRAIN.HP_MAX,
      alive: this.alive,
      x:     this.trackX,
      y:     this.locoY,
      dir:   this.direction,
    };
  }

  /** Räumt alle Phaser-Objekte auf (bei Rundenende). */
  destroy(): void {
    for (const s of this.segObjects) {
      if (s.active) s.destroy();
    }
    this.segObjects.length = 0;
    if (this.group) this.group.destroy(true);
    this.active = false;
    this.alive  = false;
  }

  // ── Hilfs-Methoden ────────────────────────────────────────────────────────

  /**
   * Start-Y der Lokomotive – komplett außerhalb der Arena.
   *
   * direction=1 (top→bottom): Lok ist die FRONT = südlichstes Segment (höchste Y).
   *   Wagons liegen nördlich (niedrigere Y-Werte). Startposition: Lok-Nordkante
   *   gerade über der Arena-Obergrenze.
   * direction=-1 (bottom→top): Lok ist die FRONT = nördlichstes Segment (niedrigste Y).
   *   Wagons liegen südlich. Startposition: Lok-Südkante gerade unter Arena-Untergrenze.
   */
  private initialLocoY(): number {
    if (this.direction === 1) {
      return ARENA_OFFSET_Y - TRAIN.LOCO_HEIGHT / 2 - 2;
    }
    return ARENA_OFFSET_Y + ARENA_HEIGHT + TRAIN.LOCO_HEIGHT / 2 + 2;
  }

  /**
   * Erstellt die unsichtbaren Hitbox-Rechtecke in der StaticGroup.
   * Positionen werden in `updateSegmentPositions` gesetzt.
   */
  private buildGroup(): void {
    this.group = this.scene.physics.add.staticGroup();
    const heights = this.segHeights();
    const ys      = this.segCenterYs();

    for (let i = 0; i < heights.length; i++) {
      const rect = this.scene.add.rectangle(
        this.trackX, ys[i],
        TRAIN.HITBOX_WIDTH, heights[i],
        0x000000, 0, // komplett transparent
      );
      rect.setVisible(false);
      this.group.add(rect);
      (rect.body as Phaser.Physics.Arcade.StaticBody).updateFromGameObject();
      this.segObjects.push(rect);
    }
  }

  /** Aktualisiert alle Hitbox-Positionen (jedes Frame). */
  private updateSegmentPositions(): void {
    const ys = this.segCenterYs();
    for (let i = 0; i < this.segObjects.length; i++) {
      const rect = this.segObjects[i];
      rect.setPosition(this.trackX, ys[i]);
      (rect.body as Phaser.Physics.Arcade.StaticBody).reset(this.trackX, ys[i]);
    }
  }

  /**
   * Berechnet die Y-Mitten aller Segmente.
   *
   * ys[0] = Lokomotive-Mitte (= this.locoY)
   * ys[1..N] = Waggons, die hinter der Fahrtrichtung liegen.
   *
   * "Hinter" = entgegen der Fahrtrichtung:
   *   direction=1  → jeder nachfolgende Waggon hat KLEINERE Y (nördlicher)
   *   direction=-1 → jeder nachfolgende Waggon hat GRÖSSERE Y (südlicher)
   */
  segCenterYs(): number[] {
    const heights = this.segHeights();
    const ys: number[] = [this.locoY];
    let prev  = this.locoY;
    let prevH = heights[0];

    for (let i = 1; i < heights.length; i++) {
      const h   = heights[i];
      const gap = prevH / 2 + TRAIN.SEGMENT_GAP + h / 2;
      // Entgegen der Fahrtrichtung → -direction
      prev = prev - this.direction * gap;
      ys.push(prev);
      prevH = h;
    }
    return ys;
  }

  /** Höhen aller Segmente: [Lok, Waggon1, Waggon2, …] */
  segHeights(): number[] {
    return [TRAIN.LOCO_HEIGHT, ...new Array(TRAIN.WAGON_COUNT).fill(TRAIN.WAGON_HEIGHT)];
  }

  /** Gesamtpixelhöhe des Zugs inkl. aller Lücken. */
  totalHeight(): number {
    return TRAIN.LOCO_HEIGHT
      + TRAIN.WAGON_COUNT * TRAIN.WAGON_HEIGHT
      + TRAIN.WAGON_COUNT * TRAIN.SEGMENT_GAP;
  }

  /** Weltkoordinaten aller Segment-Mittelpunkte (aktueller Frame). */
  getSegmentPositions(): { x: number; y: number }[] {
    return this.segCenterYs().map(y => ({ x: this.trackX, y }));
  }

  /**
   * Setzt den Zug-Zustand für einen erneuten Durchlauf zurück.
   * Muss vor dem nächsten `spawn()` aufgerufen werden.
   */
  reset(): void {
    this.hp        = TRAIN.HP_MAX;
    this.alive     = false;
    this.active    = false;
    this.destroyed = false;
    this.lastHitter = null;
    this.locoY     = this.initialLocoY();
    // Hitboxen repositionieren und deaktivieren
    this.updateSegmentPositions();
    for (const s of this.segObjects) {
      (s.body as Phaser.Physics.Arcade.StaticBody).enable = false;
    }
  }

  /**
   * Bereitet den Zug für eine erneute Einfahrt vor, ohne die HP zurückzusetzen.
   * Wird nach natürlichem Verlassen der Arena aufgerufen (Multi-Spawn).
   * @param newDirection - neue Fahrtrichtung (alternierend)
   */
  prepareReentry(newDirection: 1 | -1): void {
    this.direction  = newDirection;
    this.alive      = false;
    this.active     = false;
    this.destroyed  = false;
    this.lastHitter = null;
    this.locoY      = this.initialLocoY();
    this.updateSegmentPositions();
    for (const s of this.segObjects) {
      (s.body as Phaser.Physics.Arcade.StaticBody).enable = false;
    }
    // hp bleibt absichtlich unverändert
  }

  /**
   * True wenn der letzte Waggon die Arena vollständig verlassen hat.
   *
   * direction=1: letzter Waggon (nördlichstes Segment, niedrigste Y) verlässt Süd-Rand.
   * direction=-1: letzter Waggon (südlichstes Segment, höchste Y) verlässt Nord-Rand.
   */
  private hasFullyExited(): boolean {
    const ys     = this.segCenterYs();
    const lastY  = ys[ys.length - 1];
    const heights = this.segHeights();
    const lastH  = heights[heights.length - 1];
    if (this.direction === 1) {
      return lastY + lastH / 2 > ARENA_OFFSET_Y + ARENA_HEIGHT;
    }
    return lastY - lastH / 2 < ARENA_OFFSET_Y;
  }

  /** AABB-Overlap-Check zwischen allen Segmenten und allen aktiven Spielern. */
  private checkPlayerOverlaps(): void {
    if (!this.onPlayerHit) return;
    const halfW   = TRAIN.HITBOX_WIDTH / 2;
    const heights = this.segHeights();
    const ys      = this.segCenterYs();
    const pr      = PLAYER_SIZE / 2;

    for (const player of this.playerManager.getAllPlayers()) {
      if (!player.sprite.active) continue;
      const px = player.sprite.x;
      const py = player.sprite.y;

      for (let i = 0; i < ys.length; i++) {
        const halfH = heights[i] / 2;
        if (
          Math.abs(px - this.trackX) < halfW + pr &&
          Math.abs(py - ys[i])       < halfH + pr
        ) {
          this.onPlayerHit(player.id);
          break; // einen Kill pro Spieler pro Frame reicht
        }
      }
    }
  }

  /** Verarbeitet Zerstörung: deaktiviert Hitboxen, feuert Callback. */
  private handleDestruction(): void {
    this.destroyed = true;
    this.alive     = false;
    this.active    = false;

    for (const s of this.segObjects) {
      (s.body as Phaser.Physics.Arcade.StaticBody).enable = false;
    }

    // Mittelpunkt des Zugs für Explosionen/Drops berechnen
    const ys   = this.segCenterYs();
    const avgY = ys.reduce((a, b) => a + b, 0) / ys.length;

    this.onDestroyed?.({
      lastHitterId:     this.lastHitter,
      centerX:          this.trackX,
      centerY:          avgY,
      totalHeight:      this.totalHeight(),
      segmentPositions: ys.map(y => ({ x: this.trackX, y })),
    });
  }
}
