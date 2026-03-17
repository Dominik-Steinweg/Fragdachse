import { CELL_SIZE } from '../config';

/**
 * Zentralisierte Konfiguration für das "RB 54"-Zug-Event.
 * Alle Zahlenwerte sind hier änderbar – keine Magic Numbers im übrigen Code.
 */
export const TRAIN = {
  /** Fahrgeschwindigkeit in px/s */
  SPEED:           600,

  /** Visuelle Breite = CELL_SIZE = 48 px, exakt auf dem Gleis-Raster */
  VISUAL_WIDTH:    CELL_SIZE,        // 48

  /** Arcade-Physics-Hitbox-Breite – schmaler als Grafik (kein unfairer Randtod) */
  HITBOX_WIDTH:    44,

  /** Länge der Lokomotive in px */
  LOCO_HEIGHT:     CELL_SIZE * 2,    // 96

  /** Länge eines Waggons in px */
  WAGON_HEIGHT:    CELL_SIZE + 24,   // 72

  /** Anzahl Waggons hinter der Lokomotive */
  WAGON_COUNT:     32,

  /** Lücke zwischen Lok und erstem Waggon sowie zwischen Waggons in px */
  SEGMENT_GAP:     4,

  /** Gesamt-HP des Zugs (Shared Pool, Lok + alle Waggons zusammen) */
  HP_MAX:          300,

  /** Frags, die dem Last-Hit-Spieler gutgeschrieben werden */
  KILL_FRAGS:      3,

  /** Sekunden nach Rundenstart bis der Zug einfährt */
  SPAWN_DELAY_S:   10,

  /** Anzahl Power-ups, die bei Zerstörung des Zugs spawnen */
  POWERUP_DROPS:   3,

  /** Streifenhöhe in px für den Waggon-Geschwindigkeitseffekt */
  WAGON_STRIPE_H:  8,

  /**
   * Pseudo-Attacker-ID für Zug-Instakills.
   * Verhindert, dass ein echter Spieler einen Frag bekommt.
   */
  TRAIN_KILLER_ID: '__train__',
} as const;
