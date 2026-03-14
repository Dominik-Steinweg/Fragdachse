import Phaser from 'phaser';
import type { WeaponConfig } from '../loadout/LoadoutConfig';
import {
  ARENA_OFFSET_X, ARENA_OFFSET_Y,
  ARENA_WIDTH,    ARENA_HEIGHT,
} from '../config';

// ── Visuelle Konstanten ────────────────────────────────────────────────────
const LASER_COLOR    = 0xffffff;
const LASER_ALPHA    = 0.18;
const LASER_WIDTH    = 1;
const CROSS_COLOR    = 0xffffff;
const CROSS_ALPHA    = 0.85;
const CROSS_LINE_LEN = 8;   // px, Länge jeder Fadenkreuz-Linie
const CROSS_LINE_W   = 2;
const CROSS_GAP_MIN  = 4;   // px gap bei Gesamtspread = 0°
const CROSS_GAP_MAX  = 24;  // px gap bei maximalem Gesamtspread

// Bewegungserkennung: Mindest-Positionsänderung pro Frame in px
const MOVE_THRESHOLD = 0.3;

// ── Arena-Grenzen (gecacht) ────────────────────────────────────────────────
const AX1 = ARENA_OFFSET_X;
const AY1 = ARENA_OFFSET_Y;
const AX2 = ARENA_OFFSET_X + ARENA_WIDTH;
const AY2 = ARENA_OFFSET_Y + ARENA_HEIGHT;

// ── Client-seitiger Spread-State (Fallback für Non-Host-Clients) ──────────
interface ClientSpreadState {
  value:      number;
  lastShotAt: number;
}

/**
 * AimSystem – rein clientseitig, kein Netzwerk-Zugriff.
 *
 * Zeichnet jeden Frame:
 *   1. Laser-Linie: halbtransparente Linie vom Spieler zur Maus,
 *      auf die Reichweite (cfg.range) der aktiven Waffe gekürzt.
 *   2. Dynamisches Fadenkreuz: 4 Arme am Endpunkt; der Arm-Abstand wächst
 *      proportional zum aktuellen Gesamtspread (Basis + dynamischer Bloom).
 *
 * Clipping: Schusslinie und Fadenkreuz werden per Software auf die
 * Arena-Grenzen geclipt (kein GeometryMask, da dieser in Phaser 3 WebGL
 * das Objekt in zwei Render-Passes aufteilt → Doppelbild-Artefakt).
 * Da der Spieler stets innerhalb der Arena liegt, genügt es, den Endpunkt
 * parametrisch an die nächste Arena-Kante zu klemmen.
 *
 * Cursor-Management: In der Arena-Phase wird der System-Mauszeiger via
 * Phaser-API ausgeblendet; in der Lobby-Phase (inArena=false) ist er sichtbar.
 *
 * Bewegungserkennung erfolgt via Sprite-Positions-Delta – funktioniert
 * sowohl auf dem Host (Physics-Position) als auch auf Clients (Lerp-Position).
 *
 * Spread-Herkunft:
 *   - HOST: `getActualSpread` liest den autoritären Bloom-Wert direkt aus
 *     dem BaseWeapon-Objekt im LoadoutManager – kein redundanter Simulationscode.
 *   - CLIENT: eigene Spread-Simulation (spiegelt BaseWeapon.addSpread /
 *     decaySpread mit denselben Config-Parametern).
 */
export class AimSystem {
  private readonly gfx: Phaser.GameObjects.Graphics;

  // Welche Waffe war zuletzt aktiv
  private activeSlot: 'weapon1' | 'weapon2' = 'weapon1';

  // Client-seitige Spread-Simulation (nur genutzt wenn kein getActualSpread vorhanden)
  private readonly clientSpreads: Record<'weapon1' | 'weapon2', ClientSpreadState> = {
    weapon1: { value: 0, lastShotAt: -Infinity },
    weapon2: { value: 0, lastShotAt: -Infinity },
  };

  // Bewegungserkennung via Positions-Delta
  private prevX: number | null = null;  // null = noch nicht initialisiert
  private prevY: number | null = null;
  private isMoving    = false;
  private prevShowAim = false;  // Flankenerkennung für prevX-Reset bei Respawn

  /**
   * @param scene           Phaser-Szene
   * @param getLocalSprite  Liefert das Sprite des lokalen Spielers (null wenn nicht vorhanden)
   * @param getWeaponConfig Liefert die aktuelle WeaponConfig des angegebenen Slots.
   *                        Auf dem Host: Getter auf LoadoutManager (echte Werte).
   *                        Auf dem Client: Getter auf gecachte localWeaponConfigs in ArenaScene.
   * @param getActualSpread Optional. Liefert den tatsächlichen dynamischen Spread direkt
   *                        aus dem BaseWeapon-Objekt (nur auf dem Host verfügbar).
   *                        Wenn vorhanden, entfällt die Client-seitige Simulation.
   */
  constructor(
    private readonly scene:            Phaser.Scene,
    private readonly getLocalSprite:   () => Phaser.GameObjects.Rectangle | undefined,
    private readonly getWeaponConfig:  (slot: 'weapon1' | 'weapon2') => WeaponConfig,
    private readonly getActualSpread?: (slot: 'weapon1' | 'weapon2') => number,
  ) {
    this.gfx = scene.add.graphics();
    this.gfx.setDepth(14);  // unter Projektilen (15), über Spielern (10)
  }

  /**
   * Aufrufen wenn der lokale Spieler eine Waffe betätigt.
   * Aktualisiert den aktiven Slot und – falls kein Host-Spread-Getter vorhanden –
   * simuliert den Spread-Anstieg (mit Cooldown-Gate, da InputSystem jeden Frame feuert).
   */
  notifyShot(slot: 'weapon1' | 'weapon2'): void {
    this.activeSlot = slot;

    if (!this.getActualSpread) {
      // Client-Simulation: Spread nur erhöhen wenn Cooldown abgelaufen
      const now = Date.now();
      const cfg = this.getWeaponConfig(slot);
      const s   = this.clientSpreads[slot];
      if (now - s.lastShotAt >= cfg.cooldown) {
        s.value      = Math.min(cfg.maxDynamicSpread, s.value + cfg.spreadPerShot);
        s.lastShotAt = now;
      }
    }
  }

  /**
   * Jeden Frame aufrufen.
   * @param showAim  true → Schusslinie + Fadenkreuz zeichnen (alive, nicht vergraben)
   * @param inArena  true → Arena-Phase aktiv; steuert die Cursor-Sichtbarkeit
   * @param delta    Frame-Delta in Millisekunden
   */
  update(showAim: boolean, inArena: boolean, delta: number): void {
    // ── Cursor-Sichtbarkeit ──────────────────────────────────────────────────
    // In der Arena verstecken, in der Lobby wieder zeigen.
    this.scene.input.setDefaultCursor(inArena ? 'none' : 'default');

    // ── Reset Positions-Baseline bei Respawn / erstem Sichtbarwerden ────────
    if (showAim && !this.prevShowAim) {
      this.prevX = null;
      this.prevY = null;
    }
    this.prevShowAim = showAim;

    this.gfx.clear();
    if (!showAim) return;

    // ── 1. Lokalen Spieler ermitteln ────────────────────────────────────────
    const sprite = this.getLocalSprite();
    if (!sprite) return;

    const sx = sprite.x;
    const sy = sprite.y;

    // ── 2. Bewegungserkennung via Positions-Delta ────────────────────────────
    if (this.prevX === null) {
      // Erster sichtbarer Frame nach (Re-)Spawn: Baseline setzen, kein falsches "isMoving"
      this.prevX    = sx;
      this.prevY    = sy;
      this.isMoving = false;
    } else {
      this.isMoving = Math.abs(sx - this.prevX) > MOVE_THRESHOLD
                   || Math.abs(sy - (this.prevY ?? sy)) > MOVE_THRESHOLD;
      this.prevX = sx;
      this.prevY = sy;
    }

    // ── 3. Client-Spread-Decay simulieren (nur wenn kein Host-Spread-Getter) ──
    if (!this.getActualSpread) {
      const now = Date.now();
      for (const slotKey of ['weapon1', 'weapon2'] as const) {
        const cfg = this.getWeaponConfig(slotKey);
        const s   = this.clientSpreads[slotKey];
        if (s.value <= 0) continue;
        if (now - s.lastShotAt < cfg.spreadRecoveryDelay) continue;
        const ticks = delta / cfg.spreadRecoverySpeed;
        s.value = Math.max(0, s.value - ticks * cfg.spreadRecoveryRate);
      }
    }

    // ── 4. Aktive Waffe: Config + Spread-Werte ───────────────────────────────
    const cfg = this.getWeaponConfig(this.activeSlot);

    // Dynamischer Spread: Host liest direkt aus BaseWeapon, Client simuliert
    const dynamicSpread = this.getActualSpread
      ? this.getActualSpread(this.activeSlot)
      : this.clientSpreads[this.activeSlot].value;

    // Basisspread (abhängig von Bewegungsstatus) + dynamischer Bloom = Gesamtspread
    const baseSpread  = this.isMoving ? cfg.spreadMoving : cfg.spreadStanding;
    const totalSpread = baseSpread + dynamicSpread;

    // Normierung: Gesamtspread / maximaler möglicher Gesamtspread → Fadenkreuz-Frac
    const maxTotal = cfg.spreadMoving + cfg.maxDynamicSpread;
    const frac     = maxTotal > 0 ? Math.min(1, totalSpread / maxTotal) : 0;

    // ── 5. Richtungsvektor + geklemmter Endpunkt ────────────────────────────
    const pointer = this.scene.input.activePointer;
    const px = pointer.x;
    const py = pointer.y;
    const dx = px - sx;
    const dy = py - sy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const nx   = dist > 0 ? dx / dist : 1;
    const ny   = dist > 0 ? dy / dist : 0;
    // Erster Clip: Reichweiten-Grenze (Waffe)
    const rangeDist = Math.min(dist, cfg.range);
    const ex = sx + nx * rangeDist;
    const ey = sy + ny * rangeDist;

    // Zweiter Clip: Arena-Grenze (Software-Clipping statt GeometryMask)
    // Startpunkt (Spieler) liegt immer innerhalb der Arena →
    // parametrisches Klemmen an die nächste überschrittene Kante.
    const { x: cx, y: cy, inside } = this.clipToArena(sx, sy, ex, ey);

    // ── 6. Laser-Linie ──────────────────────────────────────────────────────
    this.gfx.lineStyle(LASER_WIDTH, LASER_COLOR, LASER_ALPHA);
    this.gfx.beginPath();
    this.gfx.moveTo(sx, sy);
    this.gfx.lineTo(cx, cy);
    this.gfx.strokePath();

    // ── 7. Dynamisches Fadenkreuz (nur wenn Endpunkt innerhalb der Arena) ───
    if (!inside) return;

    const gap = CROSS_GAP_MIN + frac * (CROSS_GAP_MAX - CROSS_GAP_MIN);

    this.gfx.lineStyle(CROSS_LINE_W, CROSS_COLOR, CROSS_ALPHA);

    // Rechts
    this.gfx.beginPath();
    this.gfx.moveTo(cx + gap, cy);
    this.gfx.lineTo(cx + gap + CROSS_LINE_LEN, cy);
    this.gfx.strokePath();

    // Links
    this.gfx.beginPath();
    this.gfx.moveTo(cx - gap, cy);
    this.gfx.lineTo(cx - gap - CROSS_LINE_LEN, cy);
    this.gfx.strokePath();

    // Unten
    this.gfx.beginPath();
    this.gfx.moveTo(cx, cy + gap);
    this.gfx.lineTo(cx, cy + gap + CROSS_LINE_LEN);
    this.gfx.strokePath();

    // Oben
    this.gfx.beginPath();
    this.gfx.moveTo(cx, cy - gap);
    this.gfx.lineTo(cx, cy - gap - CROSS_LINE_LEN);
    this.gfx.strokePath();
  }

  /** Cursor wiederherstellen und Graphics-Objekt zerstören. */
  destroy(): void {
    this.scene.input.setDefaultCursor('default');
    this.gfx.destroy();
  }

  // ── Privat: Software-Clipping ─────────────────────────────────────────────

  /**
   * Klemmt den Endpunkt (ex, ey) einer Linie ab (sx, sy) an die Arena-Grenzen.
   * (sx, sy) muss innerhalb der Arena liegen.
   *
   * @returns geklemmter Endpunkt + `inside`: true wenn (ex,ey) innerhalb der Arena lag.
   */
  private clipToArena(
    sx: number, sy: number,
    ex: number, ey: number,
  ): { x: number; y: number; inside: boolean } {
    const inside = ex >= AX1 && ex <= AX2 && ey >= AY1 && ey <= AY2;
    if (inside) return { x: ex, y: ey, inside: true };

    // Parametrisch: Linie P(t) = (sx,sy) + t * (dx,dy), t ∈ [0,1]
    // Suche kleinstes t, bei dem die Linie eine Arena-Kante erreicht.
    const dx = ex - sx;
    const dy = ey - sy;
    let t = 1;

    if (dx > 0) t = Math.min(t, (AX2 - sx) / dx);
    else if (dx < 0) t = Math.min(t, (AX1 - sx) / dx);

    if (dy > 0) t = Math.min(t, (AY2 - sy) / dy);
    else if (dy < 0) t = Math.min(t, (AY1 - sy) / dy);

    return { x: sx + t * dx, y: sy + t * dy, inside: false };
  }
}
