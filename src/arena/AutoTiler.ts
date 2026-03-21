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
  // ── Zeile 0 (Frames 0–10) ────────────────────────────────────────────────
  28,   //  0: E, SE, S
  124,  //  1: E, SE, S, SW, W
  112,  //  2: W, SW, S
  16,   //  3: S
  20,   //  4: E, S
  116,  //  5: E, S, SW, W
  92,   //  6: E, SE, S, W
  80,   //  7: S, W
  84,   //  8: S, W, E
  221,  //  9: N, E, SE, S, W, NW
  -1,   // 10: leer

  // ── Zeile 1 (Frames 11–21) ───────────────────────────────────
  31,   // 11: N, NE, E, SE, S
  255,  // 12: massiver Fels in Mitte (Alle 8 Nachbarn)
  241,  // 13: N, S, SW, W, NW
  17,   // 14: N, S
  23,   // 15: N, NE, E, S
  247,  // 16: N, NE, E, S, SW, W, NW
  223,  // 17: N, NE, E, S, SE, W, NW
  209,  // 18: N, S, W, NW
  215,  // 19: N, NE, E, S, W, NW
  119,  // 20: N, NE, E, S, SW, W
  -1,   // 21: leer

  // ── Zeile 2 (Frames 22–32) ───────────────────────────────────
  7,    // 22: N, NE, E
  199,  // 23: N, NE, E, W, NW
  193,  // 24: N, W, NW
  1,    // 25: N 
  29,   // 26: N, E, SE, S
  253,  // 27: N, E, SE, S, SW, W, NW
  127,  // 28: N, NE, E, SE, S, SW, W
  113,  // 29: N, S, SW, W
  125,  // 30: N, E, SE, S, SW, W
  93,   // 31: N, E, SE, S, W
  117,  // 32: N, E, S, SW, W

  // ── Zeile 3 (Frames 33–43) ───────────────────────────────────
  4,    // 33: E 
  68,   // 34: E, W
  64,   // 35: W (Endstück nach Westen)
  0,    // 36: freistehend (0 Nachbarn)
  5,    // 37: N, E
  197,  // 38: N, E, W, NW
  71,   // 39: N, NE, W, E
  65,   // 40: N, W
  69,   // 41: N, E, W
  87,   // 42: N, NE, E, S, W
  213,  // 43: N, E, S, W, NW

  // ── Zeile 4 (Frames 44–54) ───────────────────────────────────
  -1,   // 44: nichts
  -1,   // 45: nichts
  -1,   // 46: nichts
  -1,   // 47: nichts
  21,   // 48: N, E, S
  245,  // 49: N, E, S, SW, W, NW
  95,   // 50: N, NE, E, SE, S, W
  81,   // 51: N, S, W
  85,   // 52: N, S, W, E
  -1,   // 53: nichts
  -1    // 54: nichts
];

/** Vorgefertigte AutoTile-Konfiguration für das Rock-47-Blob-Tileset. */
export const ROCK_AUTOTILE: AutoTileConfig = {
  bitmaskToFrame: buildBlob47Table(ROCK_47_SPRITESHEET_ORDER),
};
