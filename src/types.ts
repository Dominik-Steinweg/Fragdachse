import type Phaser from 'phaser';

/** Spielerprofil – spiellogik-seitig, kein Playroom-Typ */
export interface PlayerProfile {
  id:       string;
  name:     string;
  colorHex: number;
  teamId?:  TeamId | null;
}

/** WASD-Input vom lokalen Spieler (jeden Frame an Host gesendet) */
export interface PlayerInput {
  dx: number;  // -1 | 0 | 1
  dy: number;  // -1 | 0 | 1
  aim: number; // Aim-Winkel quantisiert als uint8 (0-255 → 0-2π)
  placementPreview?: PlacementPreviewNetState | null;
}

export type PlaceableKind = 'rock' | 'turret';

export interface PlacementPreviewNetState {
  active: boolean;
  kind: PlaceableKind;
  gridX: number;
  gridY: number;
  x: number;
  y: number;
  isValid: boolean;
  frame: number;
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

export type BurrowPhase = 'idle' | 'windup' | 'underground' | 'trapped' | 'recovery';

export interface SyncedActiveHudBuff {
  defId: string;
  remainingFrac: number;
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
  burrowPhase: BurrowPhase;
  isRaging:   boolean;  // Ultimate aktiv
  burnStacks: number;
  isChargingUltimate?: boolean;
  ultimateChargeFraction?: number;
  ultimateChargeRange?: number;
  isDecoyStealthed?: boolean;
  decoyStealthRemainingFrac?: number;
  dashPhase:  0 | 1 | 2; // 0 = kein Dash, 1 = Burst, 2 = Recovery
  aim:        PlayerAimNetState;
}

export type ShieldBlockCategory = 'projectile' | 'hitscan' | 'melee' | 'explosion' | 'tesla' | 'damage_over_time';

export interface ShieldBuffHudState {
  visible: boolean;
  defId: string;
  value: number;
  maxValue: number;
  damageBonusPct: number;
}

export type TeslaDomeTargetType = 'players' | 'train' | 'rocks' | 'turrets';

export interface SyncedTeslaDomeTarget {
  x: number;
  y: number;
  type: TeslaDomeTargetType;
}

export interface SyncedTeslaDome {
  ownerId: string;
  x: number;
  y: number;
  radius: number;
  color: number;
  alpha: number;
  targets: SyncedTeslaDomeTarget[];
}

export interface SyncedEnergyShield {
  ownerId: string;
  x: number;
  y: number;
  angle: number;
  anchorDistance: number;
  radius: number;
  thickness: number;
  arcDegrees: number;
  color: number;
  alpha: number;
  flashAlpha: number;
}

export interface SyncedDecoy {
  id: number;
  ownerId: string;
  x: number;
  y: number;
  rot: number;
  hp: number;
  maxHp: number;
  armor: number;
  maxArmor: number;
  color: number;
}

/** Visueller Stil eines Projektils */
export type ProjectileStyle = 'bullet' | 'ball' | 'energy_ball' | 'spore' | 'flame' | 'bfg' | 'awp' | 'gauss' | 'rocket' | 'grenade' | 'holy_grenade' | 'translocator_puck';

/** Feineres data-driven Preset für kugelartige Projektil-Renderer. */
export type BulletVisualPreset = 'default' | 'glock' | 'xbow' | 'p90' | 'ak47' | 'shotgun' | 'awp' | 'gauss' | 'negev';

/** Data-driven Preset fuer klassische geworfene Granaten. */
export type GrenadeVisualPreset = 'he' | 'smoke' | 'molotov';

/** Visuelles Preset fuer Hitscan-Strahlen. */
export type HitscanVisualPreset = 'default' | 'asmd_primary';

/** Visuelles Preset fuer Melee-Swings. */
export type MeleeVisualPreset = 'default' | 'zeus_taser' | 'bite';

/** Variant-Preset fuer Energy-Ball-Projektile. */
export type EnergyBallVariant = 'default' | 'plasma';

/** Visueller Stil einer Explosion / Detonation. */
export type ExplosionVisualStyle = 'default' | 'holy' | 'energy' | 'nuke';

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
  readonly allowTeamDamage?: boolean;
  readonly selfKnockbackMult?: number;
  readonly rockDamageMult?: number;
  readonly trainDamageMult?: number;
  readonly color?: number;
  readonly visualStyle?: ExplosionVisualStyle;
}

export interface ImpactCloudConfig {
  readonly radius: number;
  readonly duration: number;
  readonly damagePerTick: number;
  readonly tickInterval: number;
  readonly rockDamageMult?: number;
  readonly trainDamageMult?: number;
  readonly visualVariant?: 'stink' | 'spore';
}

export type HomingTargetType = 'players' | 'train' | 'projectiles';

/** Data-driven Zielsuche/Lenkung für Projektilwaffen. */
export interface ProjectileHomingConfig {
  readonly acquireDelayMs: number;
  readonly searchRadius: number;
  readonly retargetIntervalMs: number;
  readonly maxTurnDegreesPerStep: number;
  readonly targetTypes?: readonly HomingTargetType[];
  readonly requireLineOfSight?: boolean;
  readonly excludeOwner?: boolean;
  readonly distanceWeight?: number;
  readonly forwardWeight?: number;
}

/** Projektil-Snapshot für Netzwerk-Synchronisation (Host → Clients) */
export interface SyncedProjectile {
  id:      number;
  ownerId: string;
  x:       number;
  y:       number;
  vx:      number;  // Geschwindigkeit X (px/s) – für Client-seitige Trail-Orientierung
  vy:      number;  // Geschwindigkeit Y (px/s)
  size:    number;  // px – für korrekte Client-Darstellung
  color:   number;  // hex
  allowTeamDamage?: boolean;
  ownerColor?: number; // Spielerfarbe des Schützen für projektilspezifische Akzente/VFX
  smokeTrailColor?: number; // optionales Farb-Override für Raketenrauch, sonst Spielerfarbe
  style?:  ProjectileStyle;   // fehlendes Feld = 'bullet' (Rückwärtskompatibilität)
  bulletVisualPreset?: BulletVisualPreset;
  grenadeVisualPreset?: GrenadeVisualPreset;
  energyBallVariant?: EnergyBallVariant;
  tracer?: TracerConfig;      // Tracer-Konfiguration (nur wenn Waffe einen Tracer hat)
  shotAudioKey?: ShotAudioKey;
  shotAudioVolume?: number;
}

/** Kurzlebiger Hitscan-Trace für VFX-Replikation (Host → Clients, unreliable). */
export type HitscanImpactKind = 'none' | 'player' | 'environment';

export interface SyncedHitscanTrace {
  startX:     number;
  startY:     number;
  endX:       number;
  endY:       number;
  color:      number;
  thickness:  number;
  impactKind?: HitscanImpactKind;
  visualPreset?: HitscanVisualPreset;
  shooterId?: string;
  shotId?:    number;
  shotAudioKey?: ShotAudioKey;
  shotAudioVolume?: number;
}

export interface SyncedHitEffect {
  type:       'hit';
  x:          number;
  y:          number;
  targetId:   string;
  shooterId?: string;
  targetColor?: number;
  totalDamage: number;
  hpLost:      number;
  armorLost:   number;
  isKill:      boolean;
  dirX:        number;
  dirY:        number;
  seed:        number;
}

export interface SyncedDeathEffect {
  type:        'death';
  x:           number;
  y:           number;
  targetId:    string;
  targetColor?: number;
  rotation:    number;
  seed:        number;
}

export type SyncedCombatEffect = SyncedHitEffect | SyncedDeathEffect;

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
  visualPreset?: MeleeVisualPreset;
  hitPlayer?: boolean;
  impactX?: number;
  impactY?: number;
}

/** RPC Payload Interface für Teleport-Effekte (Host → Clients). */
export interface SyncedTranslocatorFlash {
  x: number;
  y: number;
  color: number; // Spielerfarbe
  type: 'start' | 'end';
}

/** Globale Spielphase – nur vom Host per setState gesetzt */
export type GamePhase = 'LOBBY' | 'ARENA';

export type GameMode = 'deathmatch' | 'team_deathmatch' | 'capture_the_beer';

export type TeamId = 'blue' | 'red';

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

/** Audio-Key eines data-driven Schuss-/Dry-Trigger-Sounds. */
export type ShotAudioKey = string;

/** Audio-Metadaten fuer schussbezogene Loadout-Aktionen. */
export interface LoadoutShotAudioConfig {
  readonly successKey: ShotAudioKey;
  readonly failureKey?: ShotAudioKey;
  readonly successVolume?: number;
  readonly failureVolume?: number;
}

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
  ultimateAction?: 'press' | 'release';
  ultimateChargeFraction?: number;
  inputStarted?: boolean;
}

export type LoadoutUseFailureReason = 'cooldown' | 'resource' | 'blocked' | 'invalid';
export type LoadoutUseResourceKind = 'adrenaline' | 'rage';

export interface LoadoutUseResult {
  ok: boolean;
  reason?: LoadoutUseFailureReason;
  resourceKind?: LoadoutUseResourceKind;
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
  colorOverride?: number;
}

export interface UltimateChargePreviewState {
  angle: number;
  chargeFraction: number;
  cooldownFrac: number;
  isBlocked: boolean;
  minThrowSpeed: number;
  maxThrowSpeed: number;
  isGateCharge?: boolean;
  colorOverride?: number;
  range?: number;
  reticleStyle?: 'gauss';
}

/** Lokaler Preview-State für zielbasierte Utility-Aktionen. */
export interface UtilityTargetingPreviewState {
  angle: number;
  targetX: number;
  targetY: number;
}

export interface UtilityPlacementPreviewState {
  angle: number;
  targetX: number;
  targetY: number;
  gridX: number;
  gridY: number;
  isValid: boolean;
  frame: number;
  range: number;
  kind: PlaceableKind;
}

/** Konfiguration für ein gespawntes Projektil (wird von LoadoutManager an ProjectileManager übergeben) */
export interface ProjectileSpawnConfig {
  speed:           number;
  size:            number;
  damage:          number;        // 0 bei Granaten (kein Direkttreffer-Schaden)
  color:           number;        // hex
  allowTeamDamage?: boolean;
  ownerColor?:     number;        // Spielerfarbe des Schützen für projektilspezifische Akzente/VFX
  lifetime:        number;        // ms (für Bullets Lebensdauer, für Granaten = fuseTime)
  maxBounces:      number;        // 0 für Granaten
  isGrenade:       boolean;
  adrenalinGain:   number;        // Adrenalin-Gewinn für den Schützen bei Treffer
  weaponName?:     string;        // Waffenname für Killfeed
  explosion?:      ProjectileExplosionConfig;
  impactCloud?:    ImpactCloudConfig;
  homing?:         ProjectileHomingConfig;
  smokeTrailColor?: number;
  fuseTime?:       number;        // ms bis AoE-Explosion (nur Granaten)
  grenadeEffect?:  GrenadeEffectConfig;
  projectileStyle?: ProjectileStyle;  // visueller Darstellungsstil (Standard: 'bullet')
  bulletVisualPreset?: BulletVisualPreset;
  grenadeVisualPreset?: GrenadeVisualPreset;
  energyBallVariant?: EnergyBallVariant;
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
  burnDurationMs?:    number;
  burnDamagePerTick?: number;
  burnTickIntervalMs?: number;

  // BFG (optional)
  isBfg?:            boolean;   // true = BFG-Projektil (durchschlagend, Laser-Sub-Attacke)
  bfgLaserRadius?:   number;    // Laser-Reichweite in px
  bfgLaserDamage?:   number;    // Schaden pro Laser-Treffer
  bfgLaserInterval?: number;    // ms zwischen Laser-Salven

  // Erweiterte Flugphysik (Granaten/Translocator)
  frictionDelayMs?: number;           // ms Flugzeit bevor der Speed reduziert wird
  airFrictionDecayPerSec?: number;    // Speed Multiplikator pro Sekunde
  bounceFrictionMultiplier?: number;  // Speed Multiplikator beim Abprallen
  stopSpeedThreshold?: number;        // Speed, ab der das Projektil auf 0 gestoppt wird
  sourceSlot?: LoadoutSlot;
  shotAudioKey?: ShotAudioKey;
  shotAudioVolume?: number;
}

export interface DamageGrenadeEffect {
  type: 'damage';
  radius: number;
  damage: number;
  allowTeamDamage?: boolean;
  rockDamageMult?:  number;
  trainDamageMult?: number;
  visualStyle?:     ExplosionVisualStyle;
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
  allowTeamDamage?: boolean;
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
  readonly knockback?: number;       // Radialer Impuls analog Projektil-Explosionen
  readonly selfKnockbackMult?: number;
  readonly allowCrossTeam: boolean;  // true = Gegner-Detonator kann es ebenfalls zünden
  readonly explosionColor?: number;  // optionales VFX-Farb-Override
  readonly explosionVisualStyle?: ExplosionVisualStyle;
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
  sourceSlot?: LoadoutSlot;
  weaponName?: string;
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

export interface SyncedStinkCloud {
  id:         number;
  ownerId:    string;
  x:          number;
  y:          number;
  radius:     number;
  alpha:      number; // 0-1, Lifecycle-Alpha (Fade-in/-out)
  ownerColor: number; // Spielerfarbe für Fairness-Kreis
  visualVariant?: 'stink' | 'spore';
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
  allowTeamDamage?: boolean;
  ownerColor?:     number;
  boundsListener:  (hitBody: Phaser.Physics.Arcade.Body) => void;
  colliders:       Phaser.Physics.Arcade.Collider[];  // müssen beim Destroy explizit entfernt werden
  damage:          number;        // Schadenswert pro Direkttreffer
  lifetime:        number;        // ms Lebensdauer (Bullets) / fuseTime (Granaten)
  maxBounces:      number;        // maximale Abpraller
  isGrenade:       boolean;
  adrenalinGain:   number;        // Adrenalin-Gewinn für den Schützen bei Treffer
  weaponName:      string;        // Waffenname für Killfeed
  explosion?:      ProjectileExplosionConfig;
  impactCloud?:    ImpactCloudConfig;
  homing?:         ProjectileHomingConfig;
  smokeTrailColor?: number;
  lockedTargetId?: string | null;
  lockedTargetType?: HomingTargetType;
  lastHomingSearchAt?: number;
  fuseTime?:       number;
  grenadeEffect?:  GrenadeEffectConfig;
  projectileStyle?: ProjectileStyle;  // visueller Darstellungsstil
  bulletVisualPreset?: BulletVisualPreset;
  grenadeVisualPreset?: GrenadeVisualPreset;
  energyBallVariant?: EnergyBallVariant;
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
  burnDurationMs?:    number;
  burnDamagePerTick?: number;
  burnTickIntervalMs?: number;

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
  gaussHitPlayers?:  Set<string>;     // Debounce: jeden Spieler nur 1x pro Schuss treffen
  gaussHitRocks?:    Set<number>;     // Debounce: jeden Fels nur 1x pro Schuss treffen
  gaussHitTrain?:    boolean;         // Debounce: Zug nur 1x pro Schuss treffen

  // Erweiterte Flugphysik
  frictionDelayMs?: number;
  airFrictionDecayPerSec?: number;
  bounceFrictionMultiplier?: number;
  stopSpeedThreshold?: number;
  frictionActivated?: boolean;  // true sobald Phaser-Damping aktiviert wurde
  sourceSlot?: LoadoutSlot;
  shotAudioKey?: ShotAudioKey;
  shotAudioVolume?: number;

  // Anti-Tunneling: Original-Größe für geschwindigkeitsproportionale Body-Verlängerung
  originalBodySize?: number;
}

// ---- Prozedurales Arena-Layout ----

/** Ein Felsen-Gitterzelle (relativ zur Arena, 48px-Raster) */
export interface RockCell { gridX: number; gridY: number; }

export interface PlaceableFootprintCell {
  dx: number;
  dy: number;
}

/** Ein Baum-Gitterzelle (Trunk + Canopy, relativ zur Arena) */
export interface TreeCell { gridX: number; gridY: number; }

/** Eine Gleis-Gitterzelle (begehbar, Grundlage für spätere Zuglogik) */
export interface TrackCell { gridX: number; gridY: number; }

/** Eine Dirt-Gitterzelle (rein visuell, keine Kollision) */
export interface DirtCell { gridX: number; gridY: number; }

/** Ein fester Power-Up-Podest-Slot der gesamten Runde. */
export interface PowerUpPedestalCell {
  id: number;
  defId: string;
  gridX: number;
  gridY: number;
}

/** Vollständiger Arena-Layout-Deskriptor – wird vom Host generiert und via reliable-State verteilt */
export interface ArenaLayout {
  seed:   number;
  rocks:  RockCell[];
  trees:  TreeCell[];
  tracks: TrackCell[];
  dirt:   DirtCell[];
  powerUpPedestals: PowerUpPedestalCell[];
}

/** Pro-Felsen Netzwerkzustand (nur beschädigte Felsen, Delta-Kompression) */
export interface RockNetState { id: number; hp: number; }

export interface SyncedPlaceableRock {
  id: number;
  kind: PlaceableKind;
  gridX: number;
  gridY: number;
  hp: number;
  maxHp: number;
  ownerId: string;
  ownerColor: number;
  expiresAt: number;
  warningStartsAt: number;
  angle: number;
}

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

/** Synchronisierter Laufzeit-Zustand eines festen Power-Up-Podests. */
export interface SyncedPowerUpPedestal {
  id: number;
  defId: string;
  x: number;
  y: number;
  hasPowerUp: boolean;
  nextRespawnAt: number;
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
