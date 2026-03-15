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

/** Spieler-Netzwerkzustand: Position + HP + Lebend-Status + Ressourcen + Mechaniken */
export interface PlayerNetState {
  x:          number;
  y:          number;
  hp:         number;
  alive:      boolean;
  adrenaline: number;   // 0–ADRENALINE_MAX
  rage:       number;   // 0–RAGE_MAX
  isBurrowed: boolean;
  isStunned:  boolean;
  isRaging:   boolean;  // Ultimate aktiv
}

/** Projektil-Snapshot für Netzwerk-Synchronisation (Host → Clients) */
export interface SyncedProjectile {
  id:    number;
  x:     number;
  y:     number;
  size:  number;  // px – für korrekte Client-Darstellung
  color: number;  // hex
}

/** Globale Spielphase – nur vom Host per setState gesetzt */
export type GamePhase = 'LOBBY' | 'ARENA';

/** Loadout-Slot-Bezeichner */
export type LoadoutSlot = 'weapon1' | 'weapon2' | 'utility' | 'ultimate';

/** Konfiguration für ein gespawntes Projektil (wird von LoadoutManager an ProjectileManager übergeben) */
export interface ProjectileSpawnConfig {
  speed:         number;
  size:          number;
  damage:        number;        // 0 bei Granaten (kein Direkttreffer-Schaden)
  color:         number;        // hex
  lifetime:      number;        // ms (für Bullets Lebensdauer, für Granaten = fuseTime)
  maxBounces:    number;        // 0 für Granaten
  isGrenade:     boolean;
  adrenalinGain: number;        // Adrenalin-Gewinn für den Schützen bei Treffer
  weaponName?:   string;        // Waffenname für Killfeed
  fuseTime?:     number;        // ms bis AoE-Explosion (nur Granaten)
  aoeRadius?:    number;        // px AoE-Radius
  aoeDamage?:    number;        // HP-Schaden im AoE-Radius
}

/** Explodierte Granate – von ProjectileManager.hostUpdate() zurückgegeben */
export interface ExplodedGrenade {
  x:         number;
  y:         number;
  aoeRadius: number;
  aoeDamage: number;
  ownerId:   string;
}

/** Internes Tracking eines aktiven Projektils (nur auf dem Host) */
export interface TrackedProjectile {
  id:             number;
  sprite:         Phaser.GameObjects.Rectangle;
  body:           Phaser.Physics.Arcade.Body;
  bounceCount:    number;
  createdAt:      number;
  ownerId:        string;
  boundsListener: (hitBody: Phaser.Physics.Arcade.Body) => void;
  colliders:      Phaser.Physics.Arcade.Collider[];  // müssen beim Destroy explizit entfernt werden
  damage:         number;        // Schadenswert pro Direkttreffer
  lifetime:       number;        // ms Lebensdauer (Bullets) / fuseTime (Granaten)
  maxBounces:     number;        // maximale Abpraller
  isGrenade:      boolean;
  adrenalinGain:  number;        // Adrenalin-Gewinn für den Schützen bei Treffer
  weaponName:     string;        // Waffenname für Killfeed
  fuseTime?:      number;
  aoeRadius?:     number;
  aoeDamage?:     number;
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
