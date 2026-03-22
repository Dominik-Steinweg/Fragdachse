import type Phaser from 'phaser';

/** Spielerprofil – spiellogik-seitig, kein Playroom-Typ */
export interface PlayerProfile {
  id:       string;
  name:     string;
  colorHex: number;
}

/** WASD-Input vom lokalen Spieler (jeden Frame an Host gesendet) */
export interface PlayerInput {
  dx: number;  // -1 | 0 | 1
  dy: number;  // -1 | 0 | 1
  aim: number; // Aim-Winkel quantisiert als uint8 (0-255 → 0-2π)
}

/** Waffen-Slots mit Spread/Crosshair-Relevanz. */
export type WeaponSlot = 'weapon1' | 'weapon2';

/** Autoritativer Aim-State für Crosshair-Reconciliation. */
export interface PlayerAimNetState {
  revision:             number;
  isMoving:             boolean;
  weapon1DynamicSpread: number;
  weapon2DynamicSpread: number;
}

/** Spieler-Netzwerkzustand: Position + HP + Lebend-Status + Ressourcen + Mechaniken */
export interface PlayerNetState {
  x:          number;
  y:          number;
  rot:        number;   // Blickrichtung quantisiert als uint8 (0-255 → 0-2π)
  hp:         number;
  armor:      number;
  alive:      boolean;
  adrenaline: number;   // 0–ADRENALINE_MAX
  rage:       number;   // 0–RAGE_MAX
  isBurrowed: boolean;
  isStunned:  boolean;
  isRaging:   boolean;  // Ultimate aktiv
  dashPhase:  0 | 1 | 2; // 0 = kein Dash, 1 = Burst, 2 = Recovery
  aim:        PlayerAimNetState;
}

/** Visueller Stil eines Projektils */
export type ProjectileStyle = 'bullet' | 'ball' | 'flame' | 'bfg' | 'awp' | 'rocket';

/**
 * Konfiguration für die Tracer-Leuchtlinie eines Projektils (data-driven).
 * Alle Felder ohne `?` sind Pflichtangaben.
 */
export interface TracerConfig {
  readonly widthCore:  number;   // Breite der inneren hellen Linie (px)
  readonly widthGlow:  number;   // Breite des äußeren Leucht-Halos (px)
  readonly alphaCore:  number;   // Max-Opazität der inneren Linie am Bullet-Kopf (0–1)
  readonly alphaGlow:  number;   // Max-Opazität des äußeren Halos am Bullet-Kopf (0–1)
  readonly segments:   number;   // Anzahl Gradient-Abschnitte (mehr = weicherer Fade)
  readonly fadeMs:     number;   // Fadeout-Dauer nach Einschlag (ms)
  readonly maxLength?: number;   // Max. sichtbare Trail-Länge in px (undefined = voller Pfad ab Spawn)
  readonly colorCore?: number;   // Farb-Override innere Linie (undefined = Projektil-/Spielerfarbe)
  readonly colorGlow?: number;   // Farb-Override äußerer Halo (undefined = Projektil-/Spielerfarbe)
}

/** Data-driven Explosion für Projektilwaffen (Rakete, spätere explosive Shots, ...). */
export interface ProjectileExplosionConfig {
  readonly radius: number;
  readonly maxDamage: number;
  readonly minDamage: number;
  readonly knockback: number;
  readonly selfDamageMult: number;
  readonly selfKnockbackMult?: number;
  readonly rockDamageMult?: number;
  readonly trainDamageMult?: number;
  readonly color?: number;
}

/** Projektil-Snapshot für Netzwerk-Synchronisation (Host → Clients) */
export interface SyncedProjectile {
  id:      number;
  x:       number;
  y:       number;
  vx:      number;  // Geschwindigkeit X (px/s) – für Client-seitige Trail-Orientierung
  vy:      number;  // Geschwindigkeit Y (px/s)
  size:    number;  // px – für korrekte Client-Darstellung
  color:   number;  // hex
  style?:  ProjectileStyle;   // fehlendes Feld = 'bullet' (Rückwärtskompatibilität)
  tracer?: TracerConfig;      // Tracer-Konfiguration (nur wenn Waffe einen Tracer hat)
}

/** Kurzlebiger Hitscan-Trace für VFX-Replikation (Host → Clients, unreliable). */
export interface SyncedHitscanTrace {
  startX:     number;
  startY:     number;
  endX:       number;
  endY:       number;
  color:      number;
  thickness:  number;
  shooterId?: string;
  shotId?:    number;
}

/** Kurzlebiger Melee-Swing für VFX-Replikation (Host → Clients, unreliable). */
export interface SyncedMeleeSwing {
  swingId:    number;   // pro Session eindeutig, für Client-Deduplizierung
  x:          number;
  y:          number;
  angle:      number;   // Angriffs-Richtung in Radiant (Mittellinie des Bogens)
  arcDegrees: number;   // Gesamtbreite des Trefferbogens in Grad
  range:      number;   // maximale Reichweite in px
  color:      number;   // Spielerfarbe (hex)
  shooterId:  string;
}

/** Globale Spielphase – nur vom Host per setState gesetzt */
export type GamePhase = 'LOBBY' | 'ARENA';

export type RoomQualityStatus = 'waiting' | 'sampling' | 'good' | 'bad' | 'retrying';

export type RoomQualityRetryMode = 'suggest' | 'auto';

export type RoomQualityStartPolicy = 'warn' | 'block';

export interface RoomQualitySnapshot {
  status: RoomQualityStatus;
  summary: string;
  source: 'host-proxy' | 'team-ping';
  autoSearchActive: boolean;
  autoSearchAttempt: number;
  autoSearchMaxAttempts: number;
  autoSearchExhausted: boolean;
  thresholdMs: number;
  worstPingMs: number | null;
  measuredPlayers: number;
  totalPlayers: number;
  minSamplesCollected: number;
  requiredSamples: number;
  retryCount: number;
  retryMode: RoomQualityRetryMode;
  startBlocked: boolean;
}

/** Loadout-Slot-Bezeichner */
export type LoadoutSlot = 'weapon1' | 'weapon2' | 'utility' | 'ultimate';

/** Vollstaendiger, verbindlicher Lobby-Snapshot eines Spieler-Loadouts. */
export interface LoadoutCommitSnapshot {
  weapon1: string;
  weapon2: string;
  utility: string;
  ultimate: string;
}

/** Zusätzliche Parameter für eine konkrete Loadout-Aktion. */
export interface LoadoutUseParams {
  utilityChargeFraction?: number; // 0 = Minimalwurf, 1 = voller Wurf
}

/** Lokaler Preview-State für aufladbare Utility-Aktionen. */
export interface UtilityChargePreviewState {
  angle: number;
  chargeFraction: number;
  cooldownFrac: number;
  isBlocked: boolean;
  minThrowSpeed: number;
  maxThrowSpeed: number;
  isGateCharge?: boolean;  // true = Gate-Charge (muss voll aufgeladen werden, z.B. BFG)
}

/** Konfiguration für ein gespawntes Projektil (wird von LoadoutManager an ProjectileManager übergeben) */
export interface ProjectileSpawnConfig {
  speed:           number;
  size:            number;
  damage:          number;        // 0 bei Granaten (kein Direkttreffer-Schaden)
  color:           number;        // hex
  lifetime:        number;        // ms (für Bullets Lebensdauer, für Granaten = fuseTime)
  maxBounces:      number;        // 0 für Granaten
  isGrenade:       boolean;
  adrenalinGain:   number;        // Adrenalin-Gewinn für den Schützen bei Treffer
  weaponName?:     string;        // Waffenname für Killfeed
  explosion?:      ProjectileExplosionConfig;
  fuseTime?:       number;        // ms bis AoE-Explosion (nur Granaten)
  grenadeEffect?:  GrenadeEffectConfig;
  projectileStyle?: ProjectileStyle;  // visueller Darstellungsstil (Standard: 'bullet')
  tracerConfig?:    TracerConfig;     // Tracer-Leuchtlinie (optional, data-driven)
  // Detonations-System (optional)
  detonable?: DetonableConfig;  // Projektil kann durch passende Detonatoren gezündet werden
  detonator?: DetonatorConfig;  // Projektil löst passende Detonables aus (z.B. Selbst-Detonation)
  // Objekt-Schadens-Multiplikatoren (optional, Default = 1.0 = 100%)
  rockDamageMult?:  number;     // Schadensfaktor gegen Felsen
  trainDamageMult?: number;     // Schadensfaktor gegen den Zug

  // Flammenwerfer (optional)
  isFlame?:         boolean;    // true = Flammen-Hitbox (wächst, verlangsamt sich, kein Bounce)
  hitboxGrowRate?:  number;     // Hitbox-Wachstum in px/s
  hitboxMaxSize?:   number;     // maximale Hitbox-Größe in px
  velocityDecay?:   number;     // Geschwindigkeits-Multiplikator pro Sekunde (0-1, kleiner = schnellerer Abbau)

  // BFG (optional)
  isBfg?:            boolean;   // true = BFG-Projektil (durchschlagend, Laser-Sub-Attacke)
  bfgLaserRadius?:   number;    // Laser-Reichweite in px
  bfgLaserDamage?:   number;    // Schaden pro Laser-Treffer
  bfgLaserInterval?: number;    // ms zwischen Laser-Salven
}

export interface DamageGrenadeEffect {
  type: 'damage';
  radius: number;
  damage: number;
  rockDamageMult?:  number;
  trainDamageMult?: number;
  isHoly?:          boolean;  // Heilige Handgranate – goldene Explosion + Kamera-Shake
}

export interface SmokeGrenadeEffect {
  type: 'smoke';
  radius: number;
  spreadDuration: number;
  lingerDuration: number;
  dissipateDuration: number;
  maxAlpha: number;
}

export interface FireGrenadeEffect {
  type: 'fire';
  radius: number;
  damagePerTick: number;
  tickInterval: number;    // ms
  lingerDuration: number;  // ms
  rockDamageMult?:  number;
  trainDamageMult?: number;
}

export type GrenadeEffectConfig = DamageGrenadeEffect | SmokeGrenadeEffect | FireGrenadeEffect;

/**
 * Markiert ein Projektil als detonierbar durch spezifische Auslöser-Tags.
 * Data-driven: konfigurierbar pro Waffe, flexibel erweiterbar (ASMD Ball, Rakete, …).
 */
export interface DetonableConfig {
  readonly tag: string;              // Bezeichner, z.B. 'asmd_ball'
  readonly aoeDamage: number;        // Explosionsschaden bei Detonation
  readonly aoeRadius: number;        // Explosionsradius in px
  readonly allowCrossTeam: boolean;  // true = Gegner-Detonator kann es ebenfalls zünden
  readonly rockDamageMult?:  number; // Schadensfaktor gegen Felsen (Default 1.0)
  readonly trainDamageMult?: number; // Schadensfaktor gegen den Zug (Default 1.0)
}

/**
 * Markiert einen Schuss/Treffer als Detonator für passende DetonableConfig-Tags.
 * Wird an WeaponConfig geheftet; gilt sowohl für Hitscan- als auch Projektil-Waffen.
 */
export interface DetonatorConfig {
  readonly triggerTags: readonly string[];  // Tags der Projektile, die gezündet werden können
}

/** Explodierte Granate – von ProjectileManager.hostUpdate() zurückgegeben */
export interface ExplodedGrenade {
  x:      number;
  y:      number;
  ownerId: string;
  effect: GrenadeEffectConfig;
}

export interface ExplodedProjectile {
  x: number;
  y: number;
  ownerId: string;
  effect: ProjectileExplosionConfig;
}

export interface SyncedSmokeCloud {
  id:      number;
  x:       number;
  y:       number;
  radius:  number;
  alpha:   number;
  density: number;
}

export interface SyncedFireZone {
  id:     number;
  x:      number;
  y:      number;
  radius: number;
  alpha:  number; // 0-1, für visuelles Fade-in/-out
}

/** Internes Tracking eines aktiven Projektils (nur auf dem Host) */
export interface TrackedProjectile {
  id:              number;
  sprite:          Phaser.GameObjects.Shape;  // Rectangle (bullet) oder Arc (ball)
  body:            Phaser.Physics.Arcade.Body;
  pendingDestroy?: boolean;
  pendingExplosion?: boolean;
  bounceCount:     number;
  createdAt:       number;
  ownerId:         string;
  color:           number;  // hex – gespeichert bei Spawn, entkoppelt von Shape
  boundsListener:  (hitBody: Phaser.Physics.Arcade.Body) => void;
  colliders:       Phaser.Physics.Arcade.Collider[];  // müssen beim Destroy explizit entfernt werden
  damage:          number;        // Schadenswert pro Direkttreffer
  lifetime:        number;        // ms Lebensdauer (Bullets) / fuseTime (Granaten)
  maxBounces:      number;        // maximale Abpraller
  isGrenade:       boolean;
  adrenalinGain:   number;        // Adrenalin-Gewinn für den Schützen bei Treffer
  weaponName:      string;        // Waffenname für Killfeed
  explosion?:      ProjectileExplosionConfig;
  fuseTime?:       number;
  grenadeEffect?:  GrenadeEffectConfig;
  projectileStyle?: ProjectileStyle;  // visueller Darstellungsstil
  tracerConfig?:    TracerConfig;     // Tracer-Leuchtlinie (optional)
  // Detonations-System (optional)
  detonable?: DetonableConfig;  // dieses Projektil kann gezündet werden
  detonator?: DetonatorConfig;  // dieses Projektil kann andere Detonables zünden
  // Objekt-Schadens-Multiplikatoren
  rockDamageMult?:  number;
  trainDamageMult?: number;

  // Flammenwerfer (optional)
  isFlame?:         boolean;
  hitboxGrowRate?:  number;     // px/s Wachstum
  hitboxMaxSize?:   number;     // px Maximum
  velocityDecay?:   number;     // Speed-Multiplikator pro Sekunde
  initialSpeed?:    number;     // Geschwindigkeit bei Spawn (für Decay-Berechnung)

  // Granaten-Countdown (Host-intern)
  lastCountdownEmitted?: number | null;  // letzter emittierter Countdown-Wert (Dedup)

  // BFG (optional)
  isBfg?:            boolean;
  bfgLaserRadius?:   number;
  bfgLaserDamage?:   number;
  bfgLaserInterval?: number;
  lastBfgLaserAt?:   number;          // Zeitstempel der letzten Laser-Salve
  bfgHitPlayers?:    Set<string>;     // Debounce: jeden Spieler nur 1x direkt treffen
  bfgHitRocks?:      Set<number>;     // Debounce: jeden Fels nur 1x zerstören
  bfgHitTrain?:      boolean;         // Debounce: Zug nur 1x pro Projektil beschädigen

  // Anti-Tunneling: Original-Größe für geschwindigkeitsproportionale Body-Verlängerung
  originalBodySize?: number;
}

// ---- Prozedurales Arena-Layout ----

/** Ein Felsen-Gitterzelle (relativ zur Arena, 48px-Raster) */
export interface RockCell { gridX: number; gridY: number; }

/** Ein Baum-Gitterzelle (Trunk + Canopy, relativ zur Arena) */
export interface TreeCell { gridX: number; gridY: number; }

/** Eine Gleis-Gitterzelle (begehbar, Grundlage für spätere Zuglogik) */
export interface TrackCell { gridX: number; gridY: number; }

/** Eine Dirt-Gitterzelle (rein visuell, keine Kollision) */
export interface DirtCell { gridX: number; gridY: number; }

/** Vollständiger Arena-Layout-Deskriptor – wird vom Host generiert und via reliable-State verteilt */
export interface ArenaLayout {
  seed:   number;
  rocks:  RockCell[];
  trees:  TreeCell[];
  tracks: TrackCell[];
  dirt:   DirtCell[];
}

/** Pro-Felsen Netzwerkzustand (nur beschädigte Felsen, Delta-Kompression) */
export interface RockNetState { id: number; hp: number; }

/** Konfiguration des Zug-Events – einmalig vom Host veröffentlicht (reliable) */
export interface TrainEventConfig {
  trackX:    number;   // Welt-X der Gleisspalte (Mitte)
  direction: 1 | -1;  // 1 = oben→unten, -1 = unten→oben
  spawnAt:   number;   // Spielzeit in ms ab Match-Start (wann spawnt der Zug)
}

/** Per-Frame Zug-Zustand (Host → Clients, unreliable) */
export interface SyncedTrainState {
  alive:    boolean;  // false = zerstört oder noch nicht gespawnt
  x:        number;   // Welt-X (Gleismitte)
  y:        number;   // Welt-Y der Lokomotive (Mittelpunkt)
  dir:      1 | -1;   // Fahrtrichtung
  hp:       number;   // aktuell verbleibende HP (0 = zerstört)
  maxHp:    number;   // maximale HP (für HP-Bar-Berechnung)
}

/** Synchronisiertes Power-Up auf dem Boden (Host → Clients via GameState) */
export interface SyncedPowerUp {
  uid:   number;   // Eindeutige ID dieses World-Items
  defId: string;   // Schlüssel in POWERUP_DEFS
  x:     number;
  y:     number;
}

/** Aktiver Nuke-Strike (Host → Clients via GameState) */
export interface SyncedNukeStrike {
  id:          number;
  x:           number;
  y:           number;
  radius:      number;
  armedAt:     number;   // Date.now()-Zeitpunkt des Spawns
  explodeAt:   number;   // Date.now()-Zeitpunkt der Explosion
  triggeredBy: string;
}

/** Aktiver Armageddon-Meteor (Host → Clients via GameState) */
export interface SyncedMeteorStrike {
  id:        number;   // Eindeutige Meteor-ID
  x:         number;   // Einschlagsort Welt-X
  y:         number;   // Einschlagsort Welt-Y
  radius:    number;   // Schadensradius (px)
  spawnedAt: number;   // Date.now()-Zeitpunkt des Spawns (Warnkreis erscheint)
  impactAt:  number;   // Date.now()-Zeitpunkt des Einschlags
  ownerId:   string;   // Spieler-ID des Casters
}
