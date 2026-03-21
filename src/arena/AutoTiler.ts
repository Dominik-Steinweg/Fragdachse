/**
 * AutoTiler – Generisches 8-Bit-Autotiling-System (47-Blob).
 *
 * Berechnet Nachbar-Bitmasks und mappt sie auf Tile-Frame-Indizes.
 * Unterstützt das Standard-47-Blob-Tileset-Format (Tilesetter / BorisTheBrave).
 *
 * Bit-Konvention (clockwise ab N):
 *   N=1, NE=2, E=4, SE=8, S=16, SW=32, W=64, NW=128
 *
 * Corner-Suppression: Diagonale zählt nur wenn beide angrenzenden
 * Kardinale belegt sind → reduziert 256 auf exakt 47 einzigartige Masken.
 *
 * Keine Phaser-Abhängigkeit – wiederverwendbar für beliebige Terraintypen
 * (Felsen, Wege, Schlamm, Wasser, …).
 */

// ── Richtungskonstanten (8-Bit) ────────────────────────────────────────────

const N  = 1;
const NE = 2;
const E  = 4;
const SE = 8;
const S  = 16;
const SW = 32;
const W  = 64;
const NW = 128;

// ── Konfiguration ──────────────────────────────────────────────────────────

/**
 * Konfiguration für einen Terraintyp.
 * `bitmaskToFrame` ist ein 256-Entry-Array: Index = Bitmask, Wert = Tile-Frame.
 */
export interface AutoTileConfig {
  readonly bitmaskToFrame: readonly number[];
}

// ── Kernlogik ──────────────────────────────────────────────────────────────

export class AutoTiler {
  /**
   * Berechnet die 8-Bit-Nachbar-Maske für eine Gitterzelle.
   *
   * Wendet **Corner-Suppression** an: Diagonale Nachbarn zählen nur,
   * wenn beide angrenzenden Kardinale ebenfalls belegt sind.
   * Dadurch reduzieren sich die effektiv möglichen Masken auf exakt 47.
   *
   * @param gridX       Spalte der Zelle
   * @param gridY       Zeile der Zelle
   * @param isOccupied  Lookup-Funktion: (gx, gy) → boolean
   * @returns           Bitmask 0–255 (nach Corner-Suppression einer von 47 Werten)
   */
  static computeMask(
    gridX: number,
    gridY: number,
    isOccupied: (gx: number, gy: number) => boolean,
  ): number {
    const n = isOccupied(gridX, gridY - 1);
    const e = isOccupied(gridX + 1, gridY);
    const s = isOccupied(gridX, gridY + 1);
    const w = isOccupied(gridX - 1, gridY);

    let mask = 0;
    if (n) mask |= N;
    if (e) mask |= E;
    if (s) mask |= S;
    if (w) mask |= W;

    // Diagonalen nur wenn beide angrenzenden Kardinale vorhanden
    if (n && e && isOccupied(gridX + 1, gridY - 1)) mask |= NE;
    if (s && e && isOccupied(gridX + 1, gridY + 1)) mask |= SE;
    if (s && w && isOccupied(gridX - 1, gridY + 1)) mask |= SW;
    if (n && w && isOccupied(gridX - 1, gridY - 1)) mask |= NW;

    return mask;
  }

  /** Gibt den Tile-Frame-Index für eine gegebene Bitmask zurück. */
  static getFrame(mask: number, config: AutoTileConfig): number {
    return config.bitmaskToFrame[mask & 0xFF];
  }
}

// ── 47-Blob Tileset Builder ─────────────────────────────────────────────────
//
// Die 47 einzigartigen Corner-Suppressed-Masken entsprechen den 47 Tiles
// im Blob-Tileset. Die REIHENFOLGE in `spritesheetOrder` bestimmt,
// welcher Array-Index = welche Frame-Position im Spritesheet.
//
// Referenz: BorisTheBrave (https://www.boristhebrave.com/2013/07/14/tileset-roundup/)
//
// ┌─────────────────────────────────────────────────────────────────────────┐
// │ ANPASSEN: Falls das Spritesheet eine andere Tile-Reihenfolge hat,     │
// │ einfach die Werte in ROCK_47_SPRITESHEET_ORDER umsortieren.           │
// │ Der Index = Frame-Position, der Wert = die Bitmask-Konfiguration.     │
// └─────────────────────────────────────────────────────────────────────────┘

/**
 * Baut die vollständige 256-Entry-Lookup-Tabelle aus einer Spritesheet-Reihenfolge.
 *
 * Für jeden der 256 möglichen Roh-Bitmask-Werte:
 * 1. Corner-Suppression anwenden (ungültige Diagonalen entfernen)
 * 2. Ergebnis in der spritesheetOrder nachschlagen → Frame-Index
 *
 * @param spritesheetOrder  Array mit 47 Einträgen: Index = Frame im Sheet,
 *                          Wert = die corner-suppressed Bitmask.
 * @returns                 256-Entry-Array: Index = Bitmask, Wert = Frame
 */
function buildBlob47Table(spritesheetOrder: readonly number[]): number[] {
  // Inverses Mapping: corner-suppressed Mask → Frame-Index
  const maskToFrame = new Map<number, number>();
  for (let i = 0; i < spritesheetOrder.length; i++) {
    maskToFrame.set(spritesheetOrder[i], i);
  }

  // Fallback: Frame für "isolated" (Maske 0)
  const fallbackFrame = maskToFrame.get(0) ?? 0;

  const table = new Array<number>(256);
  for (let raw = 0; raw < 256; raw++) {
    // Corner-Suppression: Diagonale nur gültig wenn beide Kardinale vorhanden
    let suppressed = raw;
    const hasN = !!(raw & N);
    const hasE = !!(raw & E);
    const hasS = !!(raw & S);
    const hasW = !!(raw & W);
    if (!(hasN && hasE)) suppressed &= ~NE;
    if (!(hasS && hasE)) suppressed &= ~SE;
    if (!(hasS && hasW)) suppressed &= ~SW;
    if (!(hasN && hasW)) suppressed &= ~NW;

    table[raw] = maskToFrame.get(suppressed) ?? fallbackFrame;
  }
  return table;
}

// ── Rock 47-Blob Spritesheet-Reihenfolge ─────────────────────────────────
//
// Spritesheet: rocks47blob.png (11 Spalten × 5 Zeilen, 48×48 px pro Tile)
// Generiert mit Tilesetter (Blob Set).
//
// Jeder Eintrag = eine corner-suppressed Bitmask.
// Der INDEX = Frame-Position im Spritesheet (links→rechts, oben→unten).
//
// Nachbar-Notation: N=Norden(oben), E=Osten(rechts), S=Süden(unten),
//                   W=Westen(links), NE/SE/SW/NW=Diagonalen
//
// ┌─────────────────────────────────────────────────────────────────────────┐
// │ Falls Tiles falsch dargestellt werden:                                  │
// │ 1. Spritesheet in einem Bildeditor öffnen                              │
// │ 2. Tile an Frame-Position X identifizieren                             │
// │ 3. Passende Bitmask in diesem Array an Position X setzen               │
// │                                                                         │
// │ Debug: ROCK_AUTOTILE_DEBUG = true setzt → Tile-Index wird im           │
// │ Browsertitel angezeigt bei Hover (in ArenaBuilder implementierbar).    │
// └─────────────────────────────────────────────────────────────────────────┘

const ROCK_47_SPRITESHEET_ORDER: readonly number[] = [
  // ── Row 0 (Frames 0–10): Oben-Bereich ──────────────────────────────────
  28,   //  0: Außenecke Oben-Links + SE        (S+SE+E)
  20,   //  1: Außenecke Oben-Links ohne Diag   (S+E)
  124,  //  2: Oberkante voll                   (E+SE+S+SW+W)
  92,   //  3: Oberkante nur SE                 (E+SE+S+W)
  116,  //  4: Oberkante nur SW                 (E+S+SW+W)
  84,   //  5: Oberkante ohne Diag              (E+S+W)
  112,  //  6: Außenecke Oben-Rechts + SW       (S+SW+W)
  80,   //  7: Außenecke Oben-Rechts ohne Diag  (S+W)
  127,  //  8: Zentrum fehlt NW                 (N+NE+E+SE+S+SW+W)
  253,  //  9: Zentrum fehlt NE                 (NW+N+E+SE+S+SW+W)
  247,  // 10: Zentrum fehlt SE                 (NW+N+NE+E+S+SW+W)

  // ── Row 1 (Frames 11–21): Mitte-Bereich ────────────────────────────────
  31,   // 11: Linkskante voll                  (N+NE+E+SE+S)
  23,   // 12: Linkskante nur SE                (N+E+SE+S)
  29,   // 13: Linkskante nur NE                (N+NE+E+S)
  21,   // 14: Linkskante ohne Diag             (N+E+S)
  255,  // 15: Zentrum voll (alle 8 Nachbarn)   (NW+N+NE+E+SE+S+SW+W)
  241,  // 16: Rechtskante voll                 (NW+N+S+SW+W)
  209,  // 17: Rechtskante nur NW               (NW+N+S+W)
  113,  // 18: Rechtskante nur SW               (N+S+SW+W)
  81,   // 19: Rechtskante ohne Diag            (N+S+W)
  223,  // 20: Zentrum fehlt SW                 (NW+N+NE+E+SE+S+W)
  95,   // 21: Zentrum NE+SE (fehlt NW+SW)      (N+NE+E+SE+S+W)

  // ── Row 2 (Frames 22–32): Unten-Bereich ────────────────────────────────
  7,    // 22: Außenecke Unten-Links + NE       (N+NE+E)
  5,    // 23: Außenecke Unten-Links ohne Diag  (N+E)
  199,  // 24: Unterkante voll                  (NW+N+NE+E+W)
  71,   // 25: Unterkante nur NE                (N+NE+E+W)
  197,  // 26: Unterkante nur NW                (NW+N+E+W)
  69,   // 27: Unterkante ohne Diag             (N+E+W)
  193,  // 28: Außenecke Unten-Rechts + NW      (NW+N+W)
  65,   // 29: Außenecke Unten-Rechts ohne Diag (N+W)
  125,  // 30: Zentrum SE+SW (fehlt NW+NE)      (N+E+SE+S+SW+W)
  245,  // 31: Zentrum SW+NW (fehlt NE+SE)      (NW+N+E+S+SW+W)
  215,  // 32: Zentrum NW+NE (fehlt SE+SW)      (NW+N+NE+E+S+W)

  // ── Row 3 (Frames 33–43): Zentrum-Varianten + Sonderstücke ─────────────
  119,  // 33: Zentrum NE+SW (gegenüber)        (N+NE+E+S+SW+W)
  221,  // 34: Zentrum NW+SE (gegenüber)        (NW+N+E+SE+S+W)
  87,   // 35: Zentrum nur NE                   (N+NE+E+S+W)
  93,   // 36: Zentrum nur SE                   (N+E+SE+S+W)
  117,  // 37: Zentrum nur SW                   (N+E+S+SW+W)
  213,  // 38: Zentrum nur NW                   (NW+N+E+S+W)
  85,   // 39: Zentrum ohne Diag (alle Kard.)   (N+E+S+W)
  17,   // 40: Vertikaler Korridor              (N+S)
  68,   // 41: Horizontaler Korridor            (E+W)
  1,    // 42: Endstück nach Süden (N-Nachbar)  (N)
  4,    // 43: Endstück nach Westen (E-Nachbar) (E)

  // ── Row 4 (Frames 44–46, Rest leer) ────────────────────────────────────
  16,   // 44: Endstück nach Norden (S-Nachbar) (S)
  64,   // 45: Endstück nach Osten (W-Nachbar)  (W)
  0,    // 46: Freistehend (keine Nachbarn)
];

/** Vorgefertigte AutoTile-Konfiguration für das Rock-47-Blob-Tileset. */
export const ROCK_AUTOTILE: AutoTileConfig = {
  bitmaskToFrame: buildBlob47Table(ROCK_47_SPRITESHEET_ORDER),
};
