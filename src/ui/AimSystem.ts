import Phaser from 'phaser';
import type { WeaponConfig } from '../loadout/LoadoutConfig';

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
  private isMoving = false;

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
   * @param visible false → nur löschen (kein Zeichnen); z.B. wenn tot, vergraben oder in Lobby
   * @param delta   Frame-Delta in Millisekunden
   */
  update(visible: boolean, delta: number): void {
    this.gfx.clear();
    if (!visible) return;

    // ── 1. Lokalen Spieler ermitteln ────────────────────────────────────────
    const sprite = this.getLocalSprite();
    if (!sprite) return;

    const sx = sprite.x;
    const sy = sprite.y;

    // ── 2. Bewegungserkennung via Positions-Delta ────────────────────────────
    if (this.prevX === null) {
      // Erster sichtbarer Frame: Position als Basis speichern, kein falsches "isMoving"
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
    // Endpunkt: Mausposition oder Reichweiten-Grenze (je nachdem was näher ist)
    const clampedDist = Math.min(dist, cfg.range);
    const ex = sx + nx * clampedDist;
    const ey = sy + ny * clampedDist;

    // ── 6. Laser-Linie ──────────────────────────────────────────────────────
    this.gfx.lineStyle(LASER_WIDTH, LASER_COLOR, LASER_ALPHA);
    this.gfx.beginPath();
    this.gfx.moveTo(sx, sy);
    this.gfx.lineTo(ex, ey);
    this.gfx.strokePath();

    // ── 7. Dynamisches Fadenkreuz ───────────────────────────────────────────
    const gap = CROSS_GAP_MIN + frac * (CROSS_GAP_MAX - CROSS_GAP_MIN);

    this.gfx.lineStyle(CROSS_LINE_W, CROSS_COLOR, CROSS_ALPHA);

    // Rechts
    this.gfx.beginPath();
    this.gfx.moveTo(ex + gap, ey);
    this.gfx.lineTo(ex + gap + CROSS_LINE_LEN, ey);
    this.gfx.strokePath();

    // Links
    this.gfx.beginPath();
    this.gfx.moveTo(ex - gap, ey);
    this.gfx.lineTo(ex - gap - CROSS_LINE_LEN, ey);
    this.gfx.strokePath();

    // Unten
    this.gfx.beginPath();
    this.gfx.moveTo(ex, ey + gap);
    this.gfx.lineTo(ex, ey + gap + CROSS_LINE_LEN);
    this.gfx.strokePath();

    // Oben
    this.gfx.beginPath();
    this.gfx.moveTo(ex, ey - gap);
    this.gfx.lineTo(ex, ey - gap - CROSS_LINE_LEN);
    this.gfx.strokePath();
  }

  destroy(): void {
    this.gfx.destroy();
  }
}
