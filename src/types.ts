import type Phaser from 'phaser';

/** Spielerprofil – spiellogik-seitig, kein Playroom-Typ */
export interface PlayerProfile {
  id:       string;
  name:     string;
  colorHex: number;
}

/** WASD-Input vom lokalen Spieler (jeden Frame an Host gesendet) */
export interface PlayerInput {
  dx: number; // -1 | 0 | 1
  dy: number; // -1 | 0 | 1
}

/** Spieler-Netzwerkzustand: Position + HP + Lebend-Status */
export interface PlayerNetState {
  x:     number;
  y:     number;
  hp:    number;
  alive: boolean;
}

/** Projektil-Snapshot für Netzwerk-Synchronisation (Host → Clients) */
export interface SyncedProjectile {
  id: number;
  x:  number;
  y:  number;
}

/** Globale Spielphase – nur vom Host per setState gesetzt */
export type GamePhase = 'LOBBY' | 'ARENA';

/** Internes Tracking eines aktiven Projektils (nur auf dem Host) */
export interface TrackedProjectile {
  id:             number;
  sprite:         Phaser.GameObjects.Rectangle;
  body:           Phaser.Physics.Arcade.Body;
  bounceCount:    number;
  createdAt:      number;
  ownerId:        string;
  boundsListener: (hitBody: Phaser.Physics.Arcade.Body) => void;
}

// ---- Prozedurales Arena-Layout ----

/** Ein Felsen-Gitterzelle (relativ zur Arena, 48px-Raster) */
export interface RockCell { gridX: number; gridY: number; }

/** Ein Baum-Gitterzelle (Trunk + Canopy, relativ zur Arena) */
export interface TreeCell { gridX: number; gridY: number; }

/** Vollständiger Arena-Layout-Deskriptor – wird vom Host generiert und via reliable-State verteilt */
export interface ArenaLayout {
  seed:  number;
  rocks: RockCell[];
  trees: TreeCell[];
}

/** Pro-Felsen Netzwerkzustand (nur beschädigte Felsen, Delta-Kompression) */
export interface RockNetState { id: number; hp: number; }
