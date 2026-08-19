import type Phaser from 'phaser';

/** Authored edge from which a Coop-Defense attack enters the arena. */
export type SpawnFront = 'west' | 'north' | 'east' | 'south';

/** Spielerprofil – spiellogik-seitig, kein Transporttyp */
export interface PlayerProfile {
  id:       string;
  name:     string;
  colorHex: number;
  teamId?:  TeamId | null;
}

/**
 * Host-autoritatives Rollenmodell einer laufenden Runde.
 *
 * `participantIds` bleibt waehrend der Runde unveraendert: Die Liste beschreibt exakt den
 * Teilnehmer-Snapshot beim Rundenstart. Ein Spieler kann daraus in `spectatorIds` wechseln,
 * verliert dadurch aber nicht seine historische Zugehoerigkeit – seine Spawn-/Belohnungsrechte
 * werden immer ueber die effektive Rolle aufgeloest.
 */
export type RoundPlayerRole = 'participant' | 'spectator';

export interface RoundParticipationState {
  roundStartTime: number;
  /** Stable identity of the round while local arena loading is still in progress. */
  roundRevision: number;
  participantIds: string[];
  spectatorIds: string[];
}

export type ArenaLoadStage = 'generating' | 'building' | 'rendering' | 'ready';

/** Small host-authored round identity used to reproduce the arena locally. */
export interface ArenaDescriptor {
  roundRevision: number;
  gameMode: GameMode;
  mapId: string | null;
  seed: number;
  arenaGeneratorVersion: number;
  layoutFingerprint: string;
}

/** Reliable, low-frequency per-player status of the local arena build. */
export interface ArenaLoadReadyState {
  roundRevision: number;
  progress: number;
  stage: ArenaLoadStage;
  ready: boolean;
}

/** Host-autoritärer, replizierter Lebenszustand einer aktivierten Survival-Runde. */
export interface CoopDefenseSurvivalPlayerState {
  remainingRespawns: number;
  alive: boolean;
  eliminated: boolean;
}

export interface CoopDefenseSurvivalState {
  respawnsPerPlayer: number;
  players: Record<string, CoopDefenseSurvivalPlayerState>;
}

/** Host-autoritärer, zuverlässiger Präsentationszustand eines endlichen Coop-Encounter. */
export type CoopDefenseEncounterPresentationPhase =
  | 'incoming'
  | 'active'
  | 'cleared'
  | 'rest'
  | 'complete';

export interface CoopDefenseEncounterPresentationState {
  encounterId: string;
  /** 1-basierter Index innerhalb der endlichen Encounter-Sequenz. */
  sequenceIndex: number;
  sequenceCount: number;
  phase: CoopDefenseEncounterPresentationPhase;
  /** Host-Rundenzeit, ab der die aktuelle Phase begonnen hat. */
  phaseStartedAtMs: number;
  /** Host-Rundenzeit des nächsten Phasenwechsels; null für offene Phasen. */
  phaseEndsAtMs: number | null;
  /** All authored fronts of this encounter, independent of per-group spawn delays. */
  encounterFronts: readonly SpawnFront[];
  /** Fronts currently arriving or still relevant for the live world telegraph. */
  fronts: readonly SpawnFront[];
  /** True, sobald alle Gruppen dieses Encounters autoritativ ausgespielt wurden. */
  spawnComplete?: boolean;
  /**
   * Erledigte bzw. erwartete Gegner des laufenden Encounters. Beide Werte fehlen, solange der
   * Host keine belastbare Zuordnung hat (kein Lebendtest, noch keine registrierten Gegner).
   * Rein darstellend: Clients leiten daraus keine Clear-Bedingung ab.
   */
  enemiesDefeated?: number;
  enemiesTotal?: number;
}

/** Host-autoritärer, kleiner Lebenszyklus-Snapshot der authored Map-Events. */
export type CoopDefenseMapEventType = 'train' | 'airstrike' | 'ground-hazard';

export type CoopDefenseMapEventLifecycleState =
  | 'dormant'
  | 'scheduled'
  | 'active'
  | 'waiting-repeat'
  | 'completed';

export interface CoopDefenseMapEventPresentationEntry {
  eventId: string;
  eventType: CoopDefenseMapEventType;
  state: CoopDefenseMapEventLifecycleState;
  /** 1-basierter Durchlauf; dormant verwendet 0. */
  occurrence: number;
  /** Host-Rundenzeit ohne Countdown, zu der der Zustand gewechselt hat. */
  stateChangedAtMs: number;
  /** Host-Rundenzeit der naechsten Wirkung, sofern geplant. */
  nextActionAtMs?: number;
}

export type CoopDefenseMapEventPresentationState = readonly CoopDefenseMapEventPresentationEntry[];

/** Host-autoritärer Lebenszyklus eines Secondary Objectives. */
export type CoopDefenseSecondaryObjectiveState = 'dormant' | 'active' | 'completed' | 'failed';

export type CoopDefenseSecondaryObjectiveType = 'destroy' | 'hold' | 'carry';

/** Ein Eintrag im host-autoritär replizierten Secondary-Objective-Snapshot. */
export interface CoopDefenseSecondaryObjectivePresentationEntry {
  objectiveId: string;
  type: CoopDefenseSecondaryObjectiveType;
  state: CoopDefenseSecondaryObjectiveState;
  /** True genau für das Objective mit dem prominenten HUD-Fokus. */
  focused: boolean;
  progressCurrent: number;
  progressTotal: number;
  /** Host-Rundenzeit des letzten Zustandswechsels. */
  stateChangedAtMs: number;
}

/** Alle nicht-dormanten Objectives, in stabiler authored Reihenfolge. */
export type CoopDefenseSecondaryObjectivePresentationState = readonly CoopDefenseSecondaryObjectivePresentationEntry[];

/** WASD-Input vom lokalen Spieler (jeden Frame an Host gesendet) */
export interface PlayerInput {
  dx: number;  // -1 | 0 | 1
  dy: number;  // -1 | 0 | 1
  aim: number; // Aim-Winkel quantisiert als uint8 (0-255 → 0-2π)
  dashHeld?: boolean;
  placementPreview?: PlacementPreviewNetState | null;
}

export type PlaceableKind = 'rock' | 'turret' | 'pedestal' | 'tunnel';

export interface PlacementPreviewNetState {
  active: boolean;
  kind: PlaceableKind;
  gridX: number;
  gridY: number;
  x: number;
  y: number;
  isValid: boolean;
  frame: number;
  stage?: 1 | 2;
  anchorGridX?: number;
  anchorGridY?: number;
  anchorX?: number;
  anchorY?: number;
  constructionId?: ConstructionId;
  /** Missions-Podest: welches Power-Up auf dem Runtime-Podest erscheinen wird. */
  powerUpDefId?: string;
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
  value?: number;
  secondaryValue?: number;
  count?: number;
  secondaryCount?: number;
  stacks?: number;
  maxStacks?: number;
  availableCount?: number;
  pendingCount?: number;
  charged?: boolean;
  /** 0..1 – Staerke des Buffs; skaliert die Partikel-Intensitaet im HUD. */
  intensity?: number;
}

/** Spieler-Netzwerkzustand: Position + HP + Lebend-Status + Ressourcen + Mechaniken */
export interface PlayerNetState {
  x:          number;
  y:          number;
  rot:        number;   // Blickrichtung quantisiert als uint8 (0-255 → 0-2π)
  hp:         number;
  maxHp:      number;
  armor:      number;
  alive:      boolean;
  adrenaline: number;   // 0–ADRENALINE_MAX
  rage:       number;   // 0–RAGE_MAX
  isBurrowed: boolean;
  isStunned:  boolean;
  burrowPhase: BurrowPhase;
  isRaging:   boolean;  // Ultimate aktiv
  activeUltimateId?: string;
  burnStacks: number;
  /** Optische Familie des aktiven Entitaetsbrands; fehlt in aelteren Snapshots = normal. */
  burnVisualStyle?: GroundFireVisualStyle;
  isChargingUltimate?: boolean;
  ultimateChargeFraction?: number;
  ultimateChargeRange?: number;
  isDecoyStealthed?: boolean;
  decoyStealthRemainingFrac?: number;
  dashPhase:  0 | 1 | 2; // 0 = kein Dash, 1 = Burst, 2 = Recovery
  flameRingRadius?: number;
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

export type TeslaDomeTargetType = 'players' | 'enemies' | 'train' | 'rocks' | 'turrets' | 'bases';

export interface SyncedTeslaDomeTarget {
  x: number;
  y: number;
  type: TeslaDomeTargetType;
  /** Stable logical identity; positions are presentation data and may move each snapshot. */
  targetKey: string;
  /** Stable beam slot. A surviving lock keeps its slot until it becomes invalid. */
  slotIndex: number;
}

export interface SyncedTeslaDome {
  ownerId: string;
  x: number;
  y: number;
  radius: number;
  color: number;
  alpha: number;
  /** Absolute charge level. Visual intensity must not normalize this by max charge. */
  chargeStacks: number;
  /** Monotonically increasing for every field pulse, including pulses at max charge. */
  pulseSequence: number;
  /** Enables the strong primary-beam pulse presentation for this dome. */
  overchargePulseEnabled?: boolean;
  /** Enables the expanding electric nova presentation for this dome. */
  stormEnabled?: boolean;
  /** Optionaler Config-Schluessel fuer Nicht-Spieler-Kuppeln, z. B. den Tesla-Turm. */
  weaponId?: string;
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
  isDome: boolean;
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
export type ProjectileStyle = 'bullet' | 'ball' | 'energy_ball' | 'hydra' | 'spore' | 'flame' | 'fireball' | 'leaf_blower' | 'bfg' | 'awp' | 'gauss' | 'rocket' | 'grenade' | 'holy_grenade' | 'translocator_puck' | 'tesla_bolt';

/** Feineres data-driven Preset für kugelartige Projektil-Renderer. */
// 'awp_charged'  = voll aufgeladener Schuss (Geduldiger Tod) ohne Schneisen-Upgrade
// 'awp_corridor' = voll aufgeladener Schuss mit "Schneise der Zerstoerung" (inkl. Sturm-VFX)
export type BulletVisualPreset = 'default' | 'glock' | 'xbow' | 'p90' | 'ak47' | 'shotgun' | 'awp' | 'awp_charged' | 'awp_corridor' | 'gauss' | 'negev';

/** Data-driven Preset fuer klassische geworfene Granaten. */
export type GrenadeVisualPreset = 'he' | 'smoke' | 'molotov' | 'time_bubble' | 'fur_ball';

/** Visuelles Preset fuer Hitscan-Strahlen. */
export type HitscanVisualPreset = 'default' | 'asmd_primary' | 'plasma_burner';

/** Kontextabhaengige Supportwirkung eines Hitscan-Strahls. */
export interface HitscanSupportEffect {
  readonly type: 'plasma_burner';
  readonly healPerHit: number;
  readonly damagePerHit: number;
  /** Schadensfaktor ausschliesslich gegen feindliche Coop-Basen. */
  readonly baseDamageMult?: number;
  readonly beamColor: number;
}

/** Visuelles Preset fuer Melee-Swings. */
export type MeleeVisualPreset = 'default' | 'zeus_taser' | 'bite';
export type MeleeDamageTarget = 'players' | 'enemies' | 'decoys' | 'bases' | 'rocks' | 'train';

/** Variant-Preset fuer Energy-Ball-Projektile. */
export type EnergyBallVariant = 'default' | 'plasma';

/** Visueller Stil einer Explosion / Detonation. */
export type ExplosionVisualStyle = 'default' | 'holy' | 'energy' | 'lightning' | 'nuke' | 'void_nuke' | 'rocket' | 'mini_rocket' | 'mini_rocket_cascade' | 'train' | 'brood_hatch' | 'regeneration' | 'timebomb' | 'timebomb_pop';

/** Linearer radialer Schadensabfall: innen maxDamage, am Rand minDamage. */
export interface RadialDamageFalloffConfig {
  readonly minDamage: number;
}

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

/**
 * Vereinheitlichte Burn-Konfiguration für „brennende Treffer". Wird an Waffen
 * (Projektil/Hitscan/Melee) oder an Explosionen geheftet und löst exakt dieselbe
 * Burn-Stack-Logik aus wie Flammenwerfer und Molotov. damagePerTick = 0 oder
 * durationMs = 0 deaktiviert den Effekt (Default für Waffen ohne Upgrade).
 */
export interface BurnOnHitConfig {
  readonly durationMs: number;      // Dauer eines Burn-Stacks
  readonly damagePerTick: number;   // HP-Schaden pro Tick (0 = deaktiviert)
}

/** Herkunft eines Brand-Stacks. Direkte Flammenwerfer-Quellen duerfen Todeseffekte ausloesen. */
export type BurnOrigin = 'generic' | 'flamethrower_direct' | 'ground_fire' | 'fire_ring';

/** Optische Familie einer Brandquelle; Varianten koennen dieselbe Rasterzelle belegen. */
export type GroundFireVisualStyle = 'normal' | 'void';

/** Entitaetsgruppe, die eine Brandquelle beschaedigen und entzuenden darf. */
export type GroundFireDamageTarget = 'all' | 'players' | 'enemies';

/** Zielseite einer Explosion; `player-side` umfasst Spieler und wiederbelebte Verbündete. */
export type ExplosionDamageTarget = GroundFireDamageTarget | 'player-side';

export interface GroundFireCellEffect {
  readonly durationMs: number;
  readonly burnDurationMs: number;
  readonly burnDamagePerTick: number;
  readonly sourceId: string;
  readonly visualStyle?: GroundFireVisualStyle;
  readonly damageTarget?: GroundFireDamageTarget;
  readonly baseDamageMult?: number;
}

export interface FireChunkBurstConfig extends GroundFireCellEffect {
  readonly count: number;
  readonly searchRadius: number;
  readonly flightMs: number;
  readonly igniteCenter: boolean;
}

export interface FireChunkTarget {
  x: number;
  y: number;
}

/**
 * Nutzlast der Verstärkungsmatrix. Sie laeuft ueber den normalen Projektil-
 * Explosionspfad, erzeugt am Einschlag aber ausschliesslich ein Schutz-/Verwundbarkeitsfeld.
 */
export interface ReinforcementMatrixEffect {
  readonly durationMs: number;
  readonly damageReduction: number;
  readonly vulnerabilityBonus: number;
  readonly color: number;
}

/** @deprecated Nur fuer alte gespeicherte Projektile; fachlich gilt Verstärkungsmatrix. */
export type OverchargeFieldEffect = ReinforcementMatrixEffect;

/** Data-driven Explosion für Projektilwaffen (Rakete, spätere explosive Shots, ...). */
export interface ProjectileExplosionConfig {
  readonly radius: number;
  readonly maxDamage: number;
  readonly minDamage?: number;  // undefined = konstanter Schaden im gesamten Radius
  readonly falloffReduction?: number; // 0 = normaler Falloff, 1 = voller Schaden bis zum Rand
  readonly knockback: number;
  readonly selfDamageMult: number;
  readonly allowTeamDamage?: boolean;
  readonly damageTarget?: ExplosionDamageTarget;
  /** Optionaler zentraler Enemy-Slow einer Explosion; wird mit der normalen Merge-Logik angewandt. */
  readonly enemySlowFraction?: number;
  readonly enemySlowDurationMs?: number;
  readonly selfKnockbackMult?: number;
  /** Schadensfaktor ausschliesslich gegen feindliche Coop-Basen. */
  readonly baseDamageMult?: number;
  readonly rockDamageMult?: number;
  readonly trainDamageMult?: number;
  readonly color?: number;
  readonly visualStyle?: ExplosionVisualStyle;
  readonly burnOnHit?: BurnOnHitConfig;  // setzt Ziele im gesamten Radius in Brand
  readonly burnOrigin?: BurnOrigin;
  readonly groundFire?: FireGrenadeEffect; // persistente Feuerfläche am Einschlagsort
  readonly fireChunkBurst?: FireChunkBurstConfig;
  readonly blackHoleDurationMs?: number;
  readonly blackHolePullStrength?: number;
  /** Gemeinsame Zeitblasen-Nutzlast fuer Granaten und Projektil-Einschlaege. */
  readonly timeBubble?: TimeBubbleEffectConfig;
  readonly reinforcementMatrix?: ReinforcementMatrixEffect;
  /** @deprecated Wire-/Replay-Kompatibilitaet fuer alte Runden. */
  readonly overchargeField?: OverchargeFieldEffect;
}

export interface ImpactCloudConfig {
  readonly radius: number;
  readonly duration: number;
  readonly damagePerTick: number;
  readonly tickInterval: number;
  readonly rockDamageMult?: number;
  readonly trainDamageMult?: number;
  /** Schadensfaktor ausschliesslich gegen feindliche Coop-Basen. */
  readonly baseDamageMult?: number;
  readonly visualVariant?: DamageZoneVisualStyle;
}

/** Visueller Stil einer Schaden-über-Zeit-Fläche (DoT-Zone). */
export type DamageZoneVisualStyle = 'stink' | 'spore' | 'spore_void' | 'electric';

/**
 * Generische Konfiguration für eine Schaden-über-Zeit-Fläche, die am Explosions-
 * bzw. Detonationsort entsteht (analog zu den Impact-Clouds der Sporen). Wird an
 * Explosionen/Detonablen geheftet, damit spätere Upgrades (HE-Granate, Smoke,
 * Mini-Rakete, …) ebenfalls eine DoT-Fläche erzeugen können.
 * damagePerTick = 0 oder durationMs = 0 deaktiviert den Effekt.
 */
export interface DamageOverTimeAreaConfig {
  readonly durationMs: number;       // Lebensdauer der Fläche
  readonly damagePerTick: number;    // HP-Schaden pro Tick (0 = deaktiviert)
  readonly tickIntervalMs: number;   // ms zwischen Ticks
  readonly radiusScale?: number;     // Flächenradius = Explosionsradius × radiusScale (Default 1)
  readonly style: DamageZoneVisualStyle;  // Darstellungsstil je Waffe
  readonly rockDamageMult?: number;
  readonly trainDamageMult?: number;
  /** Schadensfaktor ausschliesslich gegen feindliche Coop-Basen. */
  readonly baseDamageMult?: number;
}

export type HomingTargetType = 'players' | 'enemies' | 'bases' | 'train' | 'projectiles' | 'turrets';
export type MiniRocketFlightPhase = 'attack' | 'coast' | 'return';

/**
 * Nutzlast eines Energieinjektor-Projektils. Es bleibt ein Support-Geschoss:
 * `CombatSystem` laesst es aus, und Treffer werden ausschliesslich ueber
 * `ProjectileManager.setSupportImpactCallback` aufgeloest.
 */
export interface ProjectileEnergyInjectorPayload {
  readonly durationMs: number;
  readonly focusDurationMs: number;
  readonly vulnerabilityBonus: number;
  readonly color: number;
}

export type EnergyInjectorConstructionEffect =
  | { readonly type: 'damage_turret'; readonly damageMultiplier: number }
  | { readonly type: 'gravity_pull'; readonly pullStrengthMultiplier: number }
  | { readonly type: 'slow_bubble'; readonly slowStrengthMultiplier: number }
  | { readonly type: 'powerup_cooldown'; readonly respawnTimeMultiplier: number };

/** Von einem Unterstuetzungsprojektil getroffenes Hindernis (Host, aus den Phaser-Collidern). */
export type SupportProjectileImpact =
  | { readonly kind: 'rock'; readonly rockId: number; readonly x: number; readonly y: number }
  | { readonly kind: 'base'; readonly x: number; readonly y: number };

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
  /** Reiner VFX-Ursprung; der autoritative Projektilpunkt bleibt x/y. */
  visualMuzzleOrigin?: { x: number; y: number };
  projectileVisualScale?: number; // optionaler Render-Faktor ohne Einfluss auf Hitbox/Physik
  smokeTrailColor?: number; // optionales Farb-Override für Raketenrauch, sonst Spielerfarbe
  style?:  ProjectileStyle;   // fehlendes Feld = 'bullet' (Rückwärtskompatibilität)
  /** Explizite Sporenpalette; verhindert, dass Void-Spore-VFX vom Farbwert abhängen. */
  sporeVisualVariant?: 'spore' | 'spore_void';
  bulletVisualPreset?: BulletVisualPreset;
  grenadeVisualPreset?: GrenadeVisualPreset;
  energyBallVariant?: EnergyBallVariant;
  velocityDecay?: number;
  tracer?: TracerConfig;      // Tracer-Konfiguration (nur wenn Waffe einen Tracer hat)
  shotAudioKey?: ShotAudioKey;
  suppressSpawnFx?: boolean;
  penetrationCount?: number;
  penetrationDamageRetention?: number;
  reflected?: boolean;
  gaussChainRadius?: number;
  gaussChainDamageFactor?: number;
  miniRocketPhase?: MiniRocketFlightPhase;
  miniRocketCascadeStage?: number;
  projectileBurnVisualStyle?: GroundFireVisualStyle;
  /** Aktiver Brand auf dem Projektil (Waffen-Upgrade oder Feuerflaechen-Imbue). */
  burning?: boolean;
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
  /** Reiner VFX-Anfang; startX/startY bleiben der Gameplay-Trace-Ursprung. */
  visualStartX?: number;
  visualStartY?: number;
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
  isCritical?: boolean;
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
  bloodEffectMultiplier?: number;
  shotAudioKey?: ShotAudioKey;
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

export type GameMode = 'deathmatch' | 'team_deathmatch' | 'capture_the_beer' | 'coop_defense';

export type TeamId = 'blue' | 'red';

export type CaptureTheBeerBeerState = 'home' | 'carried' | 'dropped';

export interface CaptureTheBeerDropFxEvent {
  kind: 'drop';
  beerTeamId: TeamId;
  x: number;
  y: number;
}

export interface CaptureTheBeerScoreFxEvent {
  kind: 'score';
  beerTeamId: TeamId;
  scoreTeamId: TeamId;
  scorerName: string;
  scorerColor: number;
  x: number;
  y: number;
}

export interface CaptureTheBeerResetFxEvent {
  kind: 'reset';
  beerTeamId: TeamId;
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
}

export type CaptureTheBeerFxEvent =
  | CaptureTheBeerDropFxEvent
  | CaptureTheBeerScoreFxEvent
  | CaptureTheBeerResetFxEvent;

export type RoomQualityStatus = 'waiting' | 'sampling' | 'good' | 'bad';

export type RoomQualityStartPolicy = 'warn' | 'block';

/** Vom Host gewaehlter Transport fuer zeitkritische Arena-Aktionen. */

export interface RoomQualitySnapshot {
  status: RoomQualityStatus;
  source: 'webrtc';
  thresholdMs: number;
  worstPingMs: number | null;
  measuredPlayers: number;
  totalPlayers: number;
  minSamplesCollected: number;
  requiredSamples: number;
  startBlocked: boolean;
}

/** Loadout-Slot-Bezeichner */
export type LoadoutSlot = 'weapon1' | 'weapon2' | 'utility' | 'ultimate';

/** Audio-Key eines data-driven Schuss-/Dry-Trigger-Sounds. */
export type ShotAudioKey = string;

/** Allgemeiner Audio-Key fuer das GameAudioSystem. */
export type AudioKey = string;

/** Persistenter Upgrade-Knoten fuer Coop-Defense-Progression. */
export interface CoopDefenseUpgradeState {
  unlocked: boolean;
  level: number;
}

/** Persistentes lokales Upgrade-Profil fuer Coop-Defense. */
export interface CoopDefenseUpgradeProfile {
  upgrades: Record<string, CoopDefenseUpgradeState>;
  /** Gemeinsame Utility-Slots (Konstrukte und Utilities), pro Klassenprofil gespeichert. */
  toolLoadout?: LoadoutToolRef[];
  /** Zuletzt gewaehlte Utility fuer die E-Taste. */
  selectedTool?: LoadoutToolRef | null;
}

/** Dauerhafte Coop-Defense-Klassenspezialisierung. */
export type CoopDefenseClassId = 'dachs_nukem' | 'dachs_of_steel' | 'inspector_gadachs';

/** Ausruestungskategorie eines dauerhaften Items. */
export type CoopDefenseItemSlot = 'helmet' | 'gloves' | 'armor' | 'boots';

/** Seltenheit bestimmt ausschliesslich die Anzahl der Zusatzeigenschaften. */
export type CoopDefenseItemRarity = 'white' | 'blue' | 'yellow';

/**
 * Gewuerfelte Zusatzeigenschaft. Gespeichert wird nur die Definitions-ID und der Wert, damit
 * Label, Bucket, Kategorie-Pool und Obergrenze in den Definitionsdaten aenderbar bleiben,
 * ohne bereits gefundene Items anzufassen.
 */
export interface CoopDefenseItemAffix {
  readonly affixId: string;
  readonly value: number;
}

/**
 * Dauerhaftes, an den Charakter gebundenes Ausruestungsteil.
 *
 * Der Kategorie-Grundwert (`baseValue`) steckt nicht in `affixes`: er ist fuer jeden Slot fest
 * definiert und wird nur in seiner Hoehe gewuerfelt.
 */
export interface CoopDefenseItem {
  readonly uid: string;
  readonly slot: CoopDefenseItemSlot;
  readonly rarity: CoopDefenseItemRarity;
  readonly itemLevel: number;
  readonly baseValue: number;
  readonly affixes: readonly CoopDefenseItemAffix[];
}

/** Offenes Belohnungsangebot nach einem Sieg. Ueberlebt Reload und Rejoin. */
export interface CoopDefensePendingItemReward {
  readonly roundEndedAt: number;
  readonly offers: readonly CoopDefenseItem[];
  /** Bereits beim Würfeln angewandte autoritative B8-Epic-Garantie; 0/undefined = keine. */
  readonly epicGuaranteeCount?: number;
}

/** Entscheidung fuer ein offenes Item-Angebot. */
export type CoopDefenseItemRewardAction = 'take' | 'equip';

/** Im ersten Inspector-Prototyp verfuegbare Konstruktionen. */
export type ConstructionId =
  | 'rocket_turret'
  | 'machine_gun_turret'
  | 'flame_turret'
  | 'tesla_turret'
  | 'gravity_turret'
  | 'slow_bubble_turret'
  | 'medic_pedestal'
  | 'armor_pedestal';

/**
 * Eintrag in den gemeinsamen Utility-Slots eines Loadouts. Konstruktionen und Utilities
 * sind hier gleichwertig; nur der Inspector besitzt derzeit solche Slots.
 */
export type LoadoutToolRef =
  | { kind: 'construction'; id: ConstructionId }
  | { kind: 'utility'; id: string };

/** Kleine, laufend aktualisierte Lobby-Vorschau fuer die sichtbare Inspector-Auswahl. */
export interface LobbyLoadoutPreviewState {
  coopDefenseClassId: CoopDefenseClassId | null;
  tools: LoadoutToolRef[];
}

/** Audio-Metadaten fuer schussbezogene Loadout-Aktionen. */
export interface LoadoutShotAudioConfig {
  readonly successKey: ShotAudioKey;
  readonly failureKey?: ShotAudioKey;
}

/** Vollstaendiger, verbindlicher Lobby-Snapshot eines Spieler-Loadouts. */
export interface LoadoutCommitSnapshot {
  weapon1: string;
  weapon2: string | null;
  utility: string;
  ultimate: string;
  coopDefenseClassId: CoopDefenseClassId | null;
  coopDefenseProfile: CoopDefenseUpgradeProfile | null;
  /** Autoritativ ausgeruestete Utility-Slots (derzeit nur Inspector). */
  tools?: LoadoutToolRef[];
  /**
   * Beim Klick auf "Bereit" eingefrorene Ausruestung. Reist im bestehenden Commit-Snapshot mit,
   * damit Items im laufenden Match unveraenderlich sind und der Host die finalen Werte kennt.
   */
  equippedItems?: readonly CoopDefenseItem[];
}

/** Zusätzliche Parameter für eine konkrete Loadout-Aktion. */
export interface LoadoutUseParams {
  utilityChargeFraction?: number; // 0 = Minimalwurf, 1 = voller Wurf
  ultimateAction?: 'press' | 'release';
  ultimateChargeFraction?: number;
  inputStarted?: boolean;
  scopeProgress?: number;  // 0–1, für fire-on-release Scope-Waffen (beim Loslassen gesetzt)
  scopeChargeProgress?: number; // 0–1, separater Schadens-Ladefortschritt einer Scope-Waffe
  scopeHolding?: boolean;  // true = RMB gehalten aber noch kein Schuss (nur holdSpeedFactor aktiv)
  tunnelAction?: 'commit';
  tunnelStartX?: number;
  tunnelStartY?: number;
  tunnelStartGridX?: number;
  tunnelStartGridY?: number;
  constructionId?: ConstructionId;
  toolRef?: LoadoutToolRef;
  /** Rueckbau eines eigenen Konstrukts; belegt keinen Ausruestungsplatz. */
  dismantle?: boolean;
}

export type LoadoutUseFailureReason = 'cooldown' | 'resource' | 'blocked' | 'invalid' | 'capacity';
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
  stage?: 1 | 2;
  anchorX?: number;
  anchorY?: number;
  anchorGridX?: number;
  anchorGridY?: number;
  sourceSlot?: 'weapon2' | 'utility' | 'ultimate';
  constructionId?: ConstructionId;
  /** Missions-Podest: welches Power-Up auf dem Runtime-Podest erscheint. */
  powerUpDefId?: string;
  /** 'dismantle' markiert ein eigenes Konstrukt zum Rueckbau statt eine Bauflaeche. */
  mode?: 'place' | 'dismantle';
}

/** Konfiguration für ein gespawntes Projektil (wird von LoadoutManager an ProjectileManager übergeben) */
export interface ProjectileSpawnConfig {
  proximityPulse?: ProjectileProximityPulseConfig;
  /** Base-mounted turret projectiles pass through their own base footprint. */
  ignoreBaseCollisions?: boolean;
  /** Placeable turret projectiles pass through the runtime rock they are mounted on. */
  ignoreRockIndex?: number;
  speed:           number;
  size:            number;
  damage:          number;        // 0 bei Granaten (kein Direkttreffer-Schaden)
  color:           number;        // hex
  /** Reiner VFX-Ursprung; der Gameplay-Spawn bleibt der x/y-Parameter von spawnProjectile. */
  visualMuzzleOrigin?: { x: number; y: number };
  allowTeamDamage?: boolean;
  ownerColor?:     number;        // Spielerfarbe des Schützen für projektilspezifische Akzente/VFX
  projectileVisualScale?: number; // optionaler Render-Faktor ohne Einfluss auf Hitbox/Physik
  lifetime:        number;        // ms (für Bullets Lebensdauer, für Granaten = fuseTime)
  maxBounces:      number;        // 0 für Granaten
  isGrenade:       boolean;
  adrenalinGain:   number;        // Adrenalin-Gewinn für den Schützen bei Treffer
  sourceId?:     string;        // Waffenname für Killfeed
  /** Marker für das Coop-Defense-Bossupgrade der Plasma Gun. */
  plasmaSwarmEnabled?: boolean;
  /** Schwarmprojektile dürfen weder Aufladungen noch weitere Schwärme erzeugen. */
  plasmaSwarmProjectile?: boolean;
  /** Host-only: Ursprungziel, das beim Start verlassen werden muss, bevor es wieder getroffen wird. */
  plasmaSwarmOriginEnemyId?: string;
  plasmaSwarmProjectileCount?: number;
  plasmaSwarmExplosionRadius?: number;
  plasmaSwarmExplosionDamage?: number;
  plasmaSwarmExplosionSlowFraction?: number;
  explosion?:      ProjectileExplosionConfig;
  enemyHitExplosion?: ProjectileExplosionConfig;  // Explosion NUR bei Gegner-/Spielertreffern (nicht Wände/Lifetime)
  impactCloud?:    ImpactCloudConfig;
  /** Sporen-Projektilpalette, aus der Impact-Cloud-Variante abgeleitet. */
  sporeVisualVariant?: 'spore' | 'spore_void';
  homing?:         ProjectileHomingConfig;
  /** Passes through logical combat targets once each, but not through world blockers. */
  piercesTargets?: boolean;
  energyInjectorPayload?: ProjectileEnergyInjectorPayload;
  sourceTurretId?: string;
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
  /** Schadensfaktor ausschliesslich gegen feindliche Coop-Basen. */
  baseDamageMult?: number;

  // Flammenwerfer (optional)
  isFlame?:         boolean;    // true = Flammen-Hitbox (wächst, verlangsamt sich, kein Bounce)
  hitboxGrowRate?:  number;     // Hitbox-Wachstum in px/s
  hitboxMaxSize?:   number;     // maximale Hitbox-Größe in px
  velocityDecay?:   number;     // Geschwindigkeits-Multiplikator pro Sekunde (0-1, kleiner = schnellerer Abbau)
  burnDurationMs?:    number;
  burnDamagePerTick?: number;
  /** Visuelle Brandfamilie des Projektilschweifs; ohne Wert = normale orange Flamme. */
  projectileBurnVisualStyle?: GroundFireVisualStyle;
  flamePiercing?:     boolean;   // true = Projektil zerstört sich nicht bei Treffern (piercing)
  canReceiveFireImbue?: boolean;
  supplementalBurnOnHit?: BurnOnHitConfig;
  fireTrail?: GroundFireCellEffect;

  // Laubblaeser (optional)
  leafBlowerMinKnockback?: number;
  leafBlowerMaxKnockback?: number;
  leafBlowerSelfPush?:     number;
  /** true = der Luftstoß übernimmt getroffene gegnerische Projektile und schleudert sie zurück. */
  leafBlowerDeflectsProjectiles?: boolean;

  // BFG (optional)
  isBfg?:            boolean;   // true = BFG-Projektil (durchschlagend, Puls-Sub-Attacke)

  // Erweiterte Flugphysik (Granaten/Translocator)
  frictionDelayMs?: number;           // ms Flugzeit bevor der Speed reduziert wird
  airFrictionDecayPerSec?: number;    // Speed Multiplikator pro Sekunde
  bounceFrictionMultiplier?: number;  // Speed Multiplikator beim Abprallen
  stopSpeedThreshold?: number;        // Speed, ab der das Projektil auf 0 gestoppt wird
  sourceSlot?: LoadoutSlot;
  shotAudioKey?: ShotAudioKey;

  // Hydra-Splitting (optional)
  splitCount?: number;
  splitSpread?: number;
  splitFactor?: number;
  splitHoming?: ProjectileHomingConfig;
  initialBounceCount?: number;
  remainingRangePx?: number;
  suppressSpawnFx?: boolean;
  penetrationCount?: number;
  penetrationDamageRetention?: number;
  penetratesRocks?: boolean;
  reflected?: boolean;
  gaussChainRadius?: number;
  gaussChainDamageFactor?: number;
  multiExplosionCount?: number;
  multiExplosionCoastMs?: number;
  miniRocketStageRangePx?: number;
  miniRocketReturnEnabled?: boolean;
  miniRocketReturnRangeBuffer?: number;
  miniRocketPickupRadius?: number;
  miniRocketPickupAdrenalineRefundFraction?: number;
  miniRocketPickupArmor?: number;
  miniRocketAdrenalineCostPaid?: number;
  miniRocketSafetyLifetimeMs?: number;
  miniRocketCascadeDamageBonusPerExplosion?: number;
  ak47ShotId?: number;
  ak47DamageMultiplier?: number;
  ak47FireSuperiorityShot?: boolean;
  shotgunOriginX?: number;
  shotgunOriginY?: number;
  shotgunResolvedRange?: number;
  shotgunProximityMaxDamageBonus?: number;
  shotgunSlowFraction?: number;
  shotgunSlowDurationMs?: number;
  hitSlowFraction?: number;
  hitSlowDurationMs?: number;
  hitVulnerabilityDurationMs?: number;
  hitKnockback?: number;
  hitKnockbackDurationMs?: number;
  fireTrailHalfWidthCells?: number;
  awpCorridorHalfWidth?: number;
  awpCorridorDamage?: number;
  awpCorridorDotDurationMs?: number;
  awpCorridorDotTickIntervalMs?: number;
  awpCorridorKnockback?: number;
  awpCorridorKnockbackDurationMs?: number;
}

export interface DamageGrenadeEffect {
  type: 'damage';
  radius: number;
  damage: number;
  damageFalloff?:   RadialDamageFalloffConfig;
  allowTeamDamage?: boolean;
  rockDamageMult?:  number;
  trainDamageMult?: number;
  /** Schadensfaktor ausschliesslich gegen feindliche Coop-Basen. */
  baseDamageMult?: number;
  visualStyle?:     ExplosionVisualStyle;
  clusterCount?: number;
  clusterRadiusFactor?: number;
  clusterDamageFactor?: number;
}

export interface SmokeGrenadeEffect {
  type: 'smoke';
  radius: number;
  spreadDuration: number;
  lingerDuration: number;
  dissipateDuration: number;
  maxAlpha: number;
  // Optionale Schaden-über-Zeit-Komponente ("Gewittersturm"). Radius und Dauer
  // werden vom Rauch übernommen; nur diese Werte steuern den Schaden.
  // damagePerTick = 0 (oder fehlend) = deaktiviert.
  dotDamagePerTick?: number;
  dotTickIntervalMs?: number;
}

export interface FireGrenadeEffect {
  type: 'fire';
  radius: number;
  damagePerTick: number;
  lingerDuration: number;  // ms
  allowTeamDamage?: boolean;
  rockDamageMult?:  number;
  trainDamageMult?: number;
  /** Schadensfaktor ausschliesslich gegen feindliche Coop-Basen. */
  baseDamageMult?: number;
  burnDurationMs?:     number;  // ms – Dauer eines Burn-Stacks pro Tick
  burnDamagePerTick?:  number;  // HP Schaden pro Burn-Tick
  sourceId?: string;
  /** Optische Brandfamilie der entstehenden Flaeche; ohne Wert normales oranges Feuer. */
  visualStyle?: GroundFireVisualStyle;
  /** Entitaetsgruppe, die die Flaeche verletzen darf; ohne Wert trifft sie alle. */
  damageTarget?: GroundFireDamageTarget;
  wildfire?: {
    speedMultiplier: number;
    trailDurationMs: number;
    trailDamagePerTick: number;
  };
}

export interface TimeBubbleEffectConfig {
  type: 'time_bubble';
  radius: number;
  duration: number;
  projectileSlowFactor: number;
  playerSlowFactor: number;
  trainSlowFactor: number;
  color?: number;
  distortion?: number;
  friendlyImmunity?: number;
}

/** @deprecated Verwende den allgemeinen TimeBubbleEffectConfig-Typ. */
export type TimeBubbleGrenadeEffect = TimeBubbleEffectConfig;

/**
 * Wurfgeschoss, das beim Ausloesen keine Explosion erzeugt, sondern Gegner absetzt
 * (Brutbombe des Wurf-Dachses).
 */
export interface SpawnEnemyGrenadeEffect {
  type: 'spawn_enemy';
  enemyKind: string;
  count: number;
  offsetPx: number;
  color?: number;
}

export type GrenadeEffectConfig =
  | DamageGrenadeEffect
  | SmokeGrenadeEffect
  | FireGrenadeEffect
  | TimeBubbleGrenadeEffect
  | SpawnEnemyGrenadeEffect;

/**
 * Markiert ein Projektil als detonierbar durch spezifische Auslöser-Tags.
 * Data-driven: konfigurierbar pro Waffe, flexibel erweiterbar (ASMD Ball, Rakete, …).
 */
export interface DetonableConfig {
  readonly comboAdrenalineGain?: number;
  readonly tag: string;              // Bezeichner, z.B. 'asmd_ball'
  readonly aoeDamage: number;        // Explosionsschaden bei Detonation
  readonly aoeRadius: number;        // Explosionsradius in px
  readonly damageFalloff?: RadialDamageFalloffConfig;
  readonly knockback?: number;       // Radialer Impuls analog Projektil-Explosionen
  readonly selfKnockbackMult?: number;
  readonly allowCrossTeam: boolean;  // true = Gegner-Detonator kann es ebenfalls zünden
  readonly explosionColor?: number;  // optionales VFX-Farb-Override
  readonly explosionVisualStyle?: ExplosionVisualStyle;
  readonly rockDamageMult?:  number; // Schadensfaktor gegen Felsen (Default 1.0)
  readonly trainDamageMult?: number; // Schadensfaktor gegen den Zug (Default 1.0)
  readonly baseDamageMult?: number;   // Schadensfaktor ausschliesslich gegen feindliche Coop-Basen
  readonly dotArea?: DamageOverTimeAreaConfig;  // optionale Schaden-über-Zeit-Fläche am Detonationsort
}

/**
 * Markiert einen Schuss/Treffer als Detonator für passende DetonableConfig-Tags.
 * Wird an WeaponConfig geheftet; gilt sowohl für Hitscan- als auch Projektil-Waffen.
 */
export interface ProjectileProximityPulseConfig {
  readonly radius: number;
  readonly damage: number;
  readonly scanIntervalMs: number;
}

export interface DetonatorConfig {
  readonly triggerTags: readonly string[];  // Tags der Projektile, die gezündet werden können
}

/**
 * Kettenblitz-Konfiguration für Hitscan-Waffen. Nach dem Primärtreffer springt
 * der Strahl vom Einschlagspunkt auf das nächstgelegene weitere Ziel über und
 * von dort wieder weiter (bis maxJumps). Bereits getroffene Ziele werden nie
 * erneut getroffen; jeder Sprung respektiert die Sichtlinie (keine Wände) und
 * verliert konfigurierbar an Schaden. maxJumps = 0 deaktiviert den Kettenblitz
 * (Default für Waffen ohne entsprechendes Upgrade).
 */
export interface ChainLightningConfig {
  readonly maxJumps: number;                  // Anzahl Sprünge (0 = deaktiviert)
  readonly searchRadius: number;              // Suchradius (px) ab dem letzten Einschlag
  readonly damageFalloffPerJump: number;      // Schadensreduktion je Sprung (0.1 = -10% beim 1. Sprung, -20% beim 2. …)
  readonly targetEnemies?: boolean;           // Gegner sind gültige Ziele
  readonly targetPlayers?: boolean;           // Spieler sind gültige Ziele
  readonly targetDecoys?: boolean;            // Decoys sind gültige Ziele
  readonly detonableTags?: readonly string[]; // detonierbare Projektile als Ziele (z.B. ['asmd_ball']) → lösen ihre Detonation aus
  readonly thicknessFalloffPerJump?: number;  // visuelle Verschmälerung des Strahls je Sprung (Default 0.2)
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
  sourceId?: string;
  projectileId?: number;
  sourceTurretId?: string;
  continuesAfterExplosion?: boolean;
}

export interface SyncedSmokeCloud {
  id:      number;
  x:       number;
  y:       number;
  radius:  number;
  alpha:   number;
  density: number;
  storm?:  boolean;  // true = elektrisierter Rauch (DoT-Upgrade aktiv) → Blitze rendern
  stormTickMs?: number;  // Intervall der Blitze = Intervall des DoT-Schadens (nur bei storm)
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
  visualVariant?: DamageZoneVisualStyle;
}

export interface SyncedTimeBubble {
  id:         number;
  ownerId:    string;
  x:          number;
  y:          number;
  radius:     number;
  alpha:      number; // 0-1, Lifecycle-Alpha (Fade-in/-out)
  color:      number;
  distortion: number; // 0-1, visuelle Intensitaet fuer Interferenz/Post-FX
}

/** Internes Tracking eines aktiven Projektils (nur auf dem Host) */
export interface TrackedProjectile {
  proximityPulse?: ProjectileProximityPulseConfig;
  lastProximityPulseAt?: number;
  id:              number;
  sprite:          Phaser.GameObjects.Shape;  // Rectangle (bullet) oder Arc (ball)
  body:            Phaser.Physics.Arcade.Body;
  lastX:           number;
  lastY:           number;
  pendingDestroy?: boolean;
  pendingExplosion?: boolean;
  bounceCount:     number;
  createdAt:       number;
  ownerId:         string;
  ignoreBaseCollisions?: boolean;
  ignoreRockIndex?: number;
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
  sourceId:      string;        // Waffenname für Killfeed
  plasmaSwarmEnabled?: boolean;
  plasmaSwarmProjectile?: boolean;
  /** Host-only: Ursprungziel des Schwarmprojektils für den initialen Hitbox-Schutz. */
  plasmaSwarmOriginEnemyId?: string;
  plasmaSwarmProjectileCount?: number;
  plasmaSwarmExplosionRadius?: number;
  plasmaSwarmExplosionDamage?: number;
  plasmaSwarmExplosionSlowFraction?: number;
  explosion?:      ProjectileExplosionConfig;
  enemyHitExplosion?: ProjectileExplosionConfig;  // Explosion NUR bei Gegner-/Spielertreffern (nicht Wände/Lifetime)
  impactCloud?:    ImpactCloudConfig;
  homing?:         ProjectileHomingConfig;
  /** Generic target piercing; `piercingHitIds` debounces every logical target. */
  piercesTargets?: boolean;
  energyInjectorPayload?: ProjectileEnergyInjectorPayload;
  sourceTurretId?: string;
  /** Nutzlast bereits an einem Hindernis abgegeben; verhindert Mehrfachwirkung vor dem Cleanup. */
  supportConsumed?: boolean;
  /** Reiner Spawn-VFX-Ursprung; Physik und Kollisionen verwenden weiterhin sprite.x/y. */
  visualMuzzleOrigin?: { x: number; y: number };
  projectileVisualScale?: number;
  smokeTrailColor?: number;
  lockedTargetId?: string | null;
  lockedTargetType?: HomingTargetType;
  lastHomingSearchAt?: number;
  fuseTime?:       number;
  grenadeEffect?:  GrenadeEffectConfig;
  projectileStyle?: ProjectileStyle;  // visueller Darstellungsstil
  /** Explizite Sporenpalette für Host- und Client-Renderer. */
  sporeVisualVariant?: 'spore' | 'spore_void';
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
  /** Schadensfaktor ausschliesslich gegen feindliche Coop-Basen. */
  baseDamageMult?: number;

  // Flammenwerfer (optional)
  isFlame?:         boolean;
  hitboxGrowRate?:  number;     // px/s Wachstum
  hitboxMaxSize?:   number;     // px Maximum
  velocityDecay?:   number;     // Speed-Multiplikator pro Sekunde
  initialSpeed?:    number;     // Geschwindigkeit bei Spawn (für Decay-Berechnung)
  burnDurationMs?:    number;
  burnDamagePerTick?: number;
  projectileBurnVisualStyle?: GroundFireVisualStyle;
  flamePierceHitIds?: Set<string>; // Pierce: bereits getroffene Ziel-IDs (kein Mehrfachtreffer)
  hitObstacleIds?: Set<number>; // Flammen treffen jedes Hindernis hoechstens einmal
  canReceiveFireImbue?: boolean;
  supplementalBurnOnHit?: BurnOnHitConfig;
  fireTrail?: GroundFireCellEffect;
  lastFireTrailCellKey?: string;

  // Laubblaeser (optional)
  leafBlowerMinKnockback?: number;
  leafBlowerMaxKnockback?: number;
  leafBlowerSelfPush?:     number;
  leafBlowerDeflectsProjectiles?: boolean;

  // Granaten-Countdown (Host-intern)
  lastCountdownEmitted?: number | null;  // letzter emittierter Countdown-Wert (Dedup)

  // BFG (optional)
  isBfg?:            boolean;
  bfgHitPlayers?:    Set<string>;     // Debounce: jeden Spieler nur 1x direkt treffen
  bfgHitRocks?:      Set<number>;     // Debounce: jeden Fels nur 1x zerstören
  bfgHitTrain?:      boolean;         // Debounce: Zug nur 1x pro Projektil beschädigen
  gaussHitPlayers?:  Set<string>;     // Debounce: jeden Spieler nur 1x pro Schuss treffen
  gaussHitRocks?:    Set<number>;     // Debounce: jeden Fels nur 1x pro Schuss treffen
  gaussHitTrain?:    boolean;         // Debounce: Zug nur 1x pro Schuss treffen
  hitBaseIds?:       Set<string>;     // Debounce: jede Basis nur 1x pro Projektil treffen

  // Erweiterte Flugphysik
  frictionDelayMs?: number;
  airFrictionDecayPerSec?: number;
  bounceFrictionMultiplier?: number;
  stopSpeedThreshold?: number;
  frictionActivated?: boolean;  // true sobald Phaser-Damping aktiviert wurde
  simulatedAgeMs?: number;
  appliedAirFrictionDecay?: number;
  timeBubbleFactor?: number;
  sourceSlot?: LoadoutSlot;
  shotAudioKey?: ShotAudioKey;

  // Hydra-Splitting
  splitCount?: number;
  splitSpread?: number;
  splitFactor?: number;
  splitHoming?: ProjectileHomingConfig;
  remainingRangePx?: number;
  suppressSpawnFx?: boolean;
  pendingHydraSplit?: {
    x: number;
    y: number;
    angles: number[];
  };
  penetrationRemaining?: number;
  penetrationDamageRetention?: number;
  penetrationHitIds?: Set<string>;
  /** Direkttreffer bereits getroffener Ziele für infinite Piercing-Projektile. */
  piercingHitIds?: Set<string>;
  penetratesRocks?: boolean;
  penetratedRockIds?: Set<number>;
  reflected?: boolean;
  gaussChainRadius?: number;
  gaussChainDamageFactor?: number;
  multiExplosionsRemaining?: number;
  multiExplosionExcludedTargetKeys?: Set<string>;
  multiExplosionCoastMs?: number;
  miniRocketStageRangePx?: number;
  miniRocketPhase?: MiniRocketFlightPhase;
  miniRocketCoastUntilAgeMs?: number;
  miniRocketNextExplosionAtAgeMs?: number;
  miniRocketDeferredExplosion?: boolean;
  miniRocketDeferredExplosionStopsAtObstacle?: boolean;
  miniRocketSpent?: boolean;
  miniRocketDestructionFxEmitted?: boolean;
  miniRocketContinuationVx?: number;
  miniRocketContinuationVy?: number;
  miniRocketHasExploded?: boolean;
  miniRocketReturnEnabled?: boolean;
  miniRocketReturnRangeBuffer?: number;
  miniRocketReturnReserveGranted?: boolean;
  miniRocketPickupRadius?: number;
  miniRocketPickupAdrenalineRefundFraction?: number;
  miniRocketPickupArmor?: number;
  miniRocketAdrenalineCostPaid?: number;
  miniRocketSafetyLifetimeMs?: number;
  miniRocketCascadeDamageBonusPerExplosion?: number;
  miniRocketExplosionIndex?: number;
  ak47ShotId?: number;
  ak47HitConfirmed?: boolean;
  ak47DamageMultiplier?: number;
  ak47FireSuperiorityShot?: boolean;
  /** Refund guard for a strategic-target hit; one penetrative projectile may refund once. */
  ak47StrategicRefunded?: boolean;
  shotgunOriginX?: number;
  shotgunOriginY?: number;
  shotgunResolvedRange?: number;
  shotgunProximityMaxDamageBonus?: number;
  shotgunSlowFraction?: number;
  shotgunSlowDurationMs?: number;
  hitSlowFraction?: number;
  hitSlowDurationMs?: number;
  hitVulnerabilityDurationMs?: number;
  hitKnockback?: number;
  hitKnockbackDurationMs?: number;
  fireTrailHalfWidthCells?: number;
  awpCorridorHalfWidth?: number;
  awpCorridorDamage?: number;
  awpCorridorDotDurationMs?: number;
  awpCorridorDotTickIntervalMs?: number;
  awpCorridorKnockback?: number;
  awpCorridorKnockbackDurationMs?: number;
  awpCorridorHitIds?: Set<string>;

  // Anti-Tunneling: Original-Größe für geschwindigkeitsproportionale Body-Verlängerung
  originalBodySize?: number;

  // Multi-Rock-Kollisions-Schutz: verhindert Doppel-Velocity-Flip wenn zwei Felsen im selben Step getroffen werden
  bounceProcessedThisStep?: boolean;
  velocityAfterFirstBounce?: { x: number; y: number };
}

// ---- Prozedurales Arena-Layout ----

/** Ein Felsen-Gitterzelle (relativ zur Arena, 48px-Raster) */
export interface RockCell {
  gridX: number;
  gridY: number;
  /** Multiplikator (0…1) auf die Armor-Drop-Chance bei Zerstörung; fehlt = normale Chance. */
  armorDropMult?: number;
}

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

export type DecalTerrainLayer = 'dirt' | 'grass' | 'rock';

/** Visuelle Oberflaeche, auf der ein Decal liegt. */
export type DecalSurface = 'ground' | 'rock';

export type DecalKey = string;

/** Eine Decal-Gitterzelle mit bereits deterministisch ausgewählter Variante und Offset. */
export interface DecalCell {
  gridX: number;
  gridY: number;
  textureKey: DecalKey;
  offsetX: number;
  offsetY: number;
  terrain: DecalTerrainLayer;
  /** Fehlend bedeutet aus Kompatibilitaetsgruenden: Boden-Decal. */
  surface?: DecalSurface;
  /** IDs aller Felsen, die dieses (ggf. uebergreifende) Decal beruehrt. */
  rockIds?: number[];
  /** Optionale native Darstellungsbreite fuer grosse Felsflaechen. */
  displaySize?: number;
  /** Optionale globale Alpha-Daempfung zusaetzlich zur PNG-Alpha. */
  alpha?: number;
  /** Seeded Rotation in Radiant; alte Layouts duerfen sie weglassen. */
  rotation?: number;
}

/** Ein fester Power-Up-Podest-Slot der gesamten Runde. */
export interface PowerUpPedestalCell {
  id: number;
  defId: string;
  gridX: number;
  gridY: number;
  /** Optionaler Map-Override; fehlt bei den global generierten PvP-Podesten. */
  respawnMs?: number;
  /** Optionaler Map-Override; fehlt bei den global generierten PvP-Podesten. */
  spawnOnArenaStart?: boolean;
  /** Ist gesetzt, wenn das Podest zusammen mit dieser Coop-Basis zerstört wird. */
  linkedBaseId?: string;
}

export type GuardianSpiritPhase = 'orbiting' | 'attacking' | 'returning' | 'impact';

/** Host-autoritatives Schutzgeist-Snapshot fuer die reine Client-Darstellung. */
export interface SyncedGuardianSpirit {
  id: number;
  ownerId: string;
  ownerColor: number;
  x: number;
  y: number;
  phase: GuardianSpiritPhase;
  targetId?: string;
}

export interface SyncedSlimeTrailCell {
  id: number;
  x: number;
  y: number;
  size: number;
  alpha: number;
}

export interface SyncedSlimedEnemy {
  enemyId: string;
  x: number;
  y: number;
  alpha: number;
}

export interface SyncedSlimeTrailSnapshot {
  cells: SyncedSlimeTrailCell[];
  affectedEnemies: SyncedSlimedEnemy[];
}

/**
 * Ein durch Fokusfeuer verwundbarer Gegner.
 *
 * Repliziert wird ausschliesslich die Darstellung – die Schadensrechnung bleibt host-only.
 * `expiresAt` ist ein absoluter Zeitpunkt statt einer Restdauer, damit der Client zwischen zwei
 * Snapshots selbst herunterzaehlen kann.
 */
export interface SyncedVulnerableEnemy {
  enemyId: string;
  expiresAt: number;
}

/** Allgemeiner, replizierter Verwundbarkeitsstatus fuer Gegner und Strukturen. */
export interface SyncedTargetVulnerability {
  targetType: 'player' | 'enemy' | 'base' | 'construction' | 'rock' | 'wall' | 'outpost' | 'structure';
  targetId: string;
  expiresAt: number;
}

/** Host-authoritative AK strategic target marker and its active-phase timing. */
export interface SyncedAk47StrategicTarget {
  ownerId: string;
  enemyId: string;
  confirmationUntil: number;
}

export interface SyncedBurningGroundCell {
  id: number;
  gridX: number;
  gridY: number;
  expiresAt: number;
  /** Anzahl gleichzeitig aktiver, eigenstaendiger Brandquellen in dieser Zelle. */
  intensity: number;
  /** Optische Familie; pro Rasterposition darf je Familie eine Zelle repliziert werden. */
  visualStyle: GroundFireVisualStyle;
}

export interface ArenaGroundHazardCell {
  gridX: number;
  gridY: number;
}

/**
 * Seed-deterministische, authored-eventgebundene Hazard-Flaeche auf dem Arena-Raster.
 *
 * Bewusst reine Geometrie: Brenndauer, Schaden, Waffenname und Look stehen ausschliesslich im
 * `mapEvents`-Eintrag und werden beim Aktivieren von dort gelesen. Eine Kopie im Layout waere eine
 * zweite Wahrheit, die bei jeder Balancing-Aenderung auseinanderlaufen kann.
 */
export interface ArenaGroundHazardZone {
  /** Authored map-event id; layout consumers must not infer a new event from geometry. */
  eventId: string;
  id: string;
  cells: ArenaGroundHazardCell[];
}

export interface SyncedBurningGroundSnapshot {
  cells: SyncedBurningGroundCell[];
}

/** Zielzelle eines replizierten Schleimblueten-Brockens. */
export interface SlimeBloomTarget {
  x: number;
  y: number;
}

/** Vollständiger lokaler Arena-Layoutzustand; wird nicht als Netzwerkpayload übertragen. */
export interface ArenaLayout {
  seed:   number;
  rocks:  RockCell[];
  trees:  TreeCell[];
  tracks: TrackCell[];
  dirt:   DirtCell[];
  decals?: DecalCell[];
  powerUpPedestals: PowerUpPedestalCell[];
  /** Seed-deterministic, inactive cells for authored ground-hazard events. */
  groundHazardZones?: ArenaGroundHazardZone[];
}

/** Pro-Felsen Netzwerkzustand (nur beschädigte Felsen, Delta-Kompression) */
export interface RockNetState { id: number; hp: number; }

/** Snapshot-Hülle für statische Rock-HP-Änderungen und Zerstörungen. */
export interface SyncedRockSnapshot {
  full: boolean;
  count: number;
  upserts: RockNetState[];
  removals: number[];
}

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
  /** Runtime-Missions-Podeste bleiben bis zum Round-Teardown bestehen. */
  indestructible?: boolean;
  enemyDestroyedExplosionRadius?: number;
  enemyDestroyedExplosionDamage?: number;
  enemyDestroyedExplosionKnockback?: number;
  lastAttackerId?: string;
  secondProjectileDamageFactor?: number;
  /**
   * Beim Platzieren eingefrorene Upgrade-Werte des Besitzers. Die Utility-Config im
   * TurretSystem ist die unveraenderte Basis-Config, deshalb muessen spielerbezogene
   * Upgrades am Turret selbst haengen.
   */
  targetRange?: number;
  turretWeaponId?: TurretWeaponId;
  constructionId?: ConstructionId;
  /** Beim Platzieren eingefrorene, typisierte Energieinjektor-Wirkung. */
  energyInjectorEffect?: EnergyInjectorConstructionEffect;
  toolRef?: LoadoutToolRef;
}

/** Waffen, die ein platzierbares Turret fuehren kann. */
export type TurretWeaponId =
  | 'SPORES'
  | 'BASE_SPORES'
  | 'SPORE_TURRET_PLASMA'
  | 'TURRET_ROCKET_BURST'
  | 'TURRET_MG'
  | 'TURRET_FLAME'
  | 'TURRET_TESLA'
  | 'TURRET_GRAVITY'
  | 'TURRET_SLOW_BUBBLE'
  | 'TURRET_VOID_FLAME'
  | 'TURRET_SPORES';

/** Aktive Verstärkungsmatrix (host-autoritativ, per GameState repliziert). */
export interface SyncedReinforcementMatrix {
  id: number;
  ownerId: string;
  x: number;
  y: number;
  radius: number;
  color: number;
  damageReduction: number;
  vulnerabilityBonus: number;
  startedAt: number;
  expiresAt: number;
}

/** @deprecated Technischer Alias fuer alte Replay-/Snapshot-Leser. */
export type SyncedOverchargeField = SyncedReinforcementMatrix;

export interface SyncedEnergyInjectorEffect {
  targetId: string;
  targetType: 'construction';
  ownerId: string;
  x: number;
  y: number;
  color: number;
  effect: EnergyInjectorConstructionEffect;
  startedAt: number;
  expiresAt: number;
}

export interface SyncedEnergyInjectorFocus {
  ownerId: string;
  targetType: 'enemy' | 'base';
  targetId: string;
  startedAt: number;
  expiresAt: number;
}

/** Aktives Fernsteuerungsziel eines Inspectors (host-autoritativ, per GameState repliziert). */
export interface SyncedRemoteControlTurret {
  turretId: string;
  ownerId: string;
  x: number;
  y: number;
  color: number;
}

/** Ortsbezogene Schadensverstaerkung eines Konstrukts aus dem Energieinjektor. */
export interface TurretDamageBuff {
  readonly damageMultiplier: number;
}

export type RepairDronePhase = 'orbiting' | 'travelling' | 'repairing' | 'returning';

export interface SyncedRepairDrone {
  ownerId: string;
  ownerColor: number;
  x: number;
  y: number;
  phase: RepairDronePhase;
  targetConstructionId?: number;
}

export interface SyncedTunnelEndpoint {
  gridX: number;
  gridY: number;
  x: number;
  y: number;
}

export interface SyncedTunnel {
  ownerId: string;
  ownerColor: number;
  entranceA: SyncedTunnelEndpoint;
  entranceB: SyncedTunnelEndpoint;
}

/**
 * Nächste Einfahrt des Zug-Events – vom Host veröffentlicht (reliable) und bei jeder
 * Wiedereinfahrt erneuert. Fehlt der Wert, fährt auf dieser Map kein Zug (mehr).
 */
export interface TrainEventConfig {
  trackX:    number;   // Welt-X der Gleisspalte (Mitte)
  direction: 1 | -1;  // 1 = oben→unten, -1 = unten→oben
  spawnAt:   number;   // absoluter Zeitstempel (ms) der nächsten Einfahrt
}

/**
 * Per-Frame Zustand einer Coop-Defense-Basis (Host → Clients, unreliable).
 * Delta-Kompression über GameState: Nicht-dormante Basen mit reduzierten HP
 * (einschließlich HP 0) sowie Basen mit aktiven Geschütztürmen werden gesendet;
 * sonst gilt für eine lebende Basis fehlend = volle HP.
 */
export interface SyncedBaseState {
  id:     string;
  hp:     number;
  maxHp:  number;
  /** Zielwinkel der an diese Basis gekoppelten Geschütztürme. */
  turrets?: SyncedBaseTurretState[];
}

export interface SyncedBaseTurretState {
  id: string;
  angle: number;
}

/** Per-Frame Zustand eines Coop-Defense-Gegners (Host → Clients, unreliable). */
export interface SyncedEnemyState {
  id:     string;
  kind:   import('./config/coopDefenseEnemies').CoopDefenseEnemyKind;
  x:      number;
  y:      number;
  rot:    number;
  hp:     number;
  maxHp:  number;
  burnStacks: number;
  /** Optische Familie des aktiven Entitaetsbrands. */
  burnVisualStyle?: GroundFireVisualStyle;
  /** Kurzlebige Plasma-Aufladung des Boss-Upgrades (0/undefined = inaktiv). */
  plasmaChargeStacks?: number;
  faction: 'hostile' | 'allied';
  /** True: Gegner ist eingebuddelt (unverwundbar, ohne Kollisionen, unsichtbar bis auf Buddel-Partikel). */
  burrowed: boolean;
  /** Ausweichschritt-Phase, identisch zum Spieler-Dash: 0 = keiner, 1 = Burst, 2 = Recovery. */
  dashPhase: 0 | 1 | 2;
  /** Replizierte Boss-Spezialaktion; `none` löscht einen zuvor sichtbaren Zustand. */
  specialAction: 'none' | 'gauss-charge' | 'phase-nuke' | 'armageddon' | 'timebomb-chase' | 'timebomb-fuse' | 'void-molotov-windup';
  specialActionEndsAt: number;
  gaussChargeProgress: number;
  gaussAimAngle: number;
  ownerId?: string;
  ownerColor?: number;
}

/** Delta-Update eines Coop-Defense-Gegners; fehlende Felder bleiben clientseitig unverändert. */
export interface SyncedEnemyDeltaState {
  id:     string;
  kind?:  import('./config/coopDefenseEnemies').CoopDefenseEnemyKind;
  x?:     number;
  y?:     number;
  rot?:   number;
  hp?:    number;
  maxHp?: number;
  burnStacks?: number;
  burnVisualStyle?: GroundFireVisualStyle;
  plasmaChargeStacks?: number;
  faction?: 'hostile' | 'allied';
  burrowed?: boolean;
  dashPhase?: 0 | 1 | 2;
  specialAction?: 'none' | 'gauss-charge' | 'phase-nuke' | 'armageddon' | 'timebomb-chase' | 'timebomb-fuse' | 'void-molotov-windup';
  specialActionEndsAt?: number;
  gaussChargeProgress?: number;
  gaussAimAngle?: number;
  ownerId?: string;
  ownerColor?: number;
}

/**
 * Kompakt kodierter Snapshot-Wrapper für Coop-Defense-Gegner (Host → Clients, unreliable).
 *
 * Upserts werden als flacher Zahlenstrom mit Per-Eintrag-Bitmaske serialisiert, statt als Array
 * von JSON-Objekten mit wiederholten Keys – das halbiert die Payload bei vielen Gegnern und
 * verkleinert vor allem den Full-Snapshot-Spike (siehe enemySnapshotCodec.ts). Gegner-IDs werden
 * numerisch übertragen (die interne String-ID `e<base36>` wird verlustfrei rekonstruiert).
 *
 * Feldnamen sind absichtlich einbuchstabig, da der Schlüssel pro Tick mitserialisiert wird.
 *
 * Es gibt keinen schweren Full-Snapshot mehr: State-Korrektur übernimmt der rollierende Refresh-Zyklus
 * (jeder Gegner wird binnen ~2 s einmal voll nachgesendet), Removals laufen über `r` (Sticky). `a` trägt
 * periodisch die vollständige Liste aktiver IDs zur Phantom-Reconciliation – kompakt statt 4-KB-Burst.
 */
export interface SyncedEnemySnapshot {
  c: number;    // Gesamtzahl aktiver Gegner (nur Telemetrie)
  u: Array<number | string>;  // flacher Upsert-Strom (siehe encodeEnemyUpsert)
  r: number[];  // entfernte Gegner-IDs (numerisch, Sticky-Removals)
  a?: number[]; // optional: vollständige Liste aktiver IDs (periodische Reconciliation)
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
  /** Mission reward visuals are either a dormant spawn marker or a placement grant. */
  pickupKind?: 'objective-marker' | 'objective-placement';
  objectiveId?: string;
}

/** Host-published metadata needed to reconstruct a temporary utility on clients. */
export interface UtilityOverrideDescriptorBase {
  readonly kind: 'utility';
  readonly utilityId: string;
}

export interface ObjectivePlacementUtilityOverrideDescriptor {
  readonly kind: 'objective-placement';
  readonly objectiveId: string;
  readonly powerUpDefId: string;
}

export type UtilityOverrideDescriptor = UtilityOverrideDescriptorBase | ObjectivePlacementUtilityOverrideDescriptor;

/** Snapshot-Hülle für Boden-Power-Ups mit Spawn-/Pickup-Deltas. */
export interface SyncedPowerUpSnapshot {
  full: boolean;
  count: number;
  upserts: SyncedPowerUp[];
  removals: number[];
}

/** Synchronisierter Laufzeit-Zustand eines festen Power-Up-Podests. */
export interface SyncedPowerUpPedestal {
  id: number;
  defId: string;
  x: number;
  y: number;
  /** Nur bei gebauten Podesten gesetzt: die Farbe des Besitzers. */
  ownerColor?: number;
  hasPowerUp: boolean;
  nextRespawnAt: number;
}

/**
 * Delta-Snapshot der Power-Up-Podeste. Podeste sind statisch (Position/Typ ändern sich nie) und
 * wechseln nur selten ihren Zustand (`hasPowerUp`/`nextRespawnAt`). Statt das volle Array jeden Tick
 * zu senden (~335 B), wird nur bei Änderung ein Upsert übertragen; ein periodischer Full-Resync
 * korrigiert verlorene Frames. `removals` bleibt im Normalfall leer (Membership ist rundenstabil).
 */
export interface SyncedPowerUpPedestalSnapshot {
  full: boolean;
  upserts: SyncedPowerUpPedestal[];
  removals: number[];
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
  variant: 'normal' | 'void';
}

/** Aktiver Luftangriff-Strike (Host → Clients via GameState) */
export interface SyncedAirstrikeStrike {
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
  variant: 'normal' | 'void';
}

export interface SyncedCaptureTheBeerBeer {
  teamId: TeamId;
  defaultX: number;
  defaultY: number;
  x: number;
  y: number;
  holderId: string | null;
  state: CaptureTheBeerBeerState;
}

export interface SyncedCaptureTheBeerState {
  scores: Record<TeamId, number>;
  beers: SyncedCaptureTheBeerBeer[];
}

export type CoopDefenseCarryItemState = 'spawned' | 'carried' | 'dropped';

/** Host snapshot of one independent Carry objective item. */
export interface SyncedCoopDefenseCarryItem {
  id: string;
  objectiveId: string;
  x: number;
  y: number;
  holderId: string | null;
  state: CoopDefenseCarryItemState;
}

export type SyncedCoopDefenseCarryState = SyncedCoopDefenseCarryItem[];
