import rawCoopDefenseMaps from './coopDefenseMaps.json';
import {
  getCoopDefenseEnemyConfig,
  resolveCoopDefenseEnemyWaveConfig,
  type CoopDefenseEnemyKind,
} from './coopDefenseEnemies';
import { shouldDelayFirstPedestalSpawn, TIMED_POWERUP_PEDESTAL_CONFIGS } from '../powerups/PowerUpConfig';
import {
  DEFAULT_COOP_DEFENSE_ARENA_WIDTH_CELLS,
  normalizeCoopDefenseArenaWidthCells,
  ROCK_FILL_RATIO,
} from '../config';
import { DEFAULT_TIME_OF_DAY_MINUTES, formatTimeOfDay, parseTimeOfDay } from '../effects/TimeOfDay';
import { normalizeCoopDefensePlayerScalingFactor } from './coopDefenseScaling';

/** Mittag: helle Arena ohne Lightmap-Kosten. Gilt auch für alle Nicht-Coop-Modi. */
const DEFAULT_MAP_TIME_OF_DAY = formatTimeOfDay(DEFAULT_TIME_OF_DAY_MINUTES);

/** Obergrenze für `rockFillRatio` – darüber lässt die Konnektivitätsprüfung kaum noch Gänge übrig. */
const MAX_ROCK_FILL_RATIO = 0.85;

/**
 * Unterhalb dieses Radius würde ein Gang stellenweise nur noch eine Zelle breit werden – zu eng
 * für Dachse und die perfekte Falle für steckenbleibende Gegner.
 */
const MIN_CORRIDOR_RADIUS_CELLS = 1.05;

/** Standard-Abstand der Verfolgungs-Einzelschläge, wenn eine Map keinen eigenen Wert setzt. */
const DEFAULT_AIRSTRIKE_HUNT_INTERVAL_MS = 10_000;

/**
 * Standard-Multiplikator auf die Armor-Drop-Chance von Felsen der Tutorial-Formation (0…1).
 * Diese Felsen werden nur zugebaut, um den Bereich unter dem Tutorial-Hinweisfenster zu füllen,
 * und anschliessend vom Eröffnungs-Luftangriff planmässig weggesprengt – ohne Reduktion würden
 * Spieler dadurch quasi-garantiert Armor geschenkt bekommen.
 */
const DEFAULT_TUTORIAL_ROCK_ARMOR_DROP_MULT = 0.15;

/** Standard-HP-Faktor fuer jede zusaetzliche Spielerin bzw. jeden zusaetzlichen Spieler an Feindstrukturen. */
export const DEFAULT_COOP_DEFENSE_STRUCTURE_HP_FACTOR_PER_ADDITIONAL_PLAYER = 0.5;

export interface CoopBaseCellOffset {
  readonly gridX: number;
  readonly gridY: number;
}

export type CoopBaseAnchor =
  | { kind: 'right-center'; edgeInsetCells: number }
  | { kind: 'left-center'; edgeInsetCells: number }
  | { kind: 'center-offset'; dxCells: number; dyCells: number }
  | { kind: 'grid'; gridX: number; gridY: number };

export type CoopBaseShape =
  | { kind: 'rectangle'; widthCells: number; heightCells: number }
  | { kind: 'cells'; cells: readonly CoopBaseCellOffset[] };

export type CoopBaseTurretMountSide = 'front' | 'rear' | 'top' | 'bottom';
export type CoopBaseTurretWeaponId =
  | 'SPOREN'
  | 'BASE_SPOREN'
  | 'FLIEGENPILZ_PLASMA'
  | 'TURRET_ROCKET'
  | 'TURRET_MG'
  | 'TURRET_FLAME'
  | 'TURRET_VOID_FLAME'
  | 'TURRET_SPORE';

export interface CoopBaseTurretConfig {
  readonly id: string;
  readonly cellOffset: CoopBaseCellOffset;
  readonly mountSide: CoopBaseTurretMountSide;
  readonly weaponId: CoopBaseTurretWeaponId;
}

export interface CoopBasePowerUpPedestalConfig {
  readonly id: string;
  readonly cellOffset: CoopBaseCellOffset;
  readonly defId: string;
  readonly respawnMs: number;
  readonly spawnOnArenaStart?: boolean;
}

export interface CoopBasePlayerScaling {
  readonly maxHpFactorPerAdditionalPlayer?: number;
}

/**
 * `friendly` ist die zu verteidigende Basis (Standard). `hostile` gehoert der Gegnerfraktion:
 * Zombies laufen nicht dorthin, Reparatur und Schilde greifen nicht, und nur sie kann vom
 * Spieler beschaedigt werden.
 */
export type CoopBaseFaction = 'friendly' | 'hostile';
export type CoopBaseRole = 'main' | 'outpost' | 'spawn-point';

export interface CoopBaseConfig {
  readonly id: string;
  readonly hpMax: number;
  /** Optionaler HP-Faktor; feindliche Strukturen verwenden sonst den zentralen Standard. */
  readonly playerScaling?: CoopBasePlayerScaling;
  readonly faction?: CoopBaseFaction;
  readonly role?: CoopBaseRole;
  readonly anchor: CoopBaseAnchor;
  readonly shape: CoopBaseShape;
  readonly turrets?: readonly CoopBaseTurretConfig[];
  readonly powerUpPedestals?: readonly CoopBasePowerUpPedestalConfig[];
  /** Freie Zelle innerhalb der Shape, an der die Spawnpunkt-Welle erscheint. */
  readonly spawnCenter?: CoopBaseCellOffset;
  /** Wellenplan, der ausschließlich von diesem Spawnpunkt erzeugt wird. */
  readonly spawnWave?: CoopDefenseMapWaveConfig;
}

export interface CoopDefenseMapWaveConfig {
  readonly enemyKind: CoopDefenseEnemyKind;
  readonly intervalMs: number;
  readonly countPerWave: number;
  readonly startAtMs?: number;
  /** True: Welle startet erst, wenn das Eröffnungsbombardement (enemyAirstrikes) den Felsbereich geräumt hat. */
  readonly startsAfterAirstrikeBarrage?: boolean;
}

export interface ResolvedCoopDefenseMapWaveConfig {
  readonly enemyKind: CoopDefenseEnemyKind;
  readonly intervalMs: number;
  readonly countPerWave: number;
  readonly startAtMs: number;
  readonly startsAfterAirstrikeBarrage: boolean;
}

/** Konfiguriert die Zombie-Luftangriffe einer Map (siehe `CoopDefenseAirstrikeDirector`). */
export interface CoopDefenseMapAirstrikeConfig {
  /** True: Eröffnungsbombardement räumt den Tutorial-Felsbereich (Default: true). */
  readonly bombTutorialRock?: boolean;
  /** Abstand zwischen den Verfolgungs-Einzelschlägen nach der Eröffnung, in ms (Default: 10000). */
  readonly huntIntervalMs?: number;
}

export interface CoopDefenseMapBossConfig {
  readonly enemyKind: CoopDefenseEnemyKind;
  readonly spawnAtMs: number;
}

/**
 * Siegbedingung der Map.
 *
 * Jede Map hat genau ein Ziel: Zeit ueberleben, den Boss besiegen oder alle feindlichen Basen
 * zerstoeren. Verloren wird in allen Faellen ueber die eigenen Basen.
 */
export type CoopDefenseMapObjective = 'survive' | 'defeat-boss' | 'destroy-hostile-bases';

export function getCoopDefenseMapObjectiveLabel(objective: CoopDefenseMapObjective | undefined): string {
  switch (objective) {
    case 'defeat-boss':
      return 'BOSS MUSS FALLEN';
    case 'destroy-hostile-bases':
      return 'FEINDBASIS ZERSTOEREN';
    case 'survive':
    default:
      return 'ZEIT UEBERLEBEN';
  }
}

/**
 * Belohnt einen Sieg auf dieser Map mit einem Item-Angebot. Bewusst pro Map konfigurierbar und
 * bewusst wiederholbar: anders als Boss-Punkte zaehlt jeder erneute Sieg erneut.
 */
export interface CoopDefenseMapItemDropConfig {
  /** Bestimmt die Hoehe der Grundwerte und der Eigenschaftsspannen. */
  readonly itemLevel: number;
}

export type CoopDefensePowerUpRegion = 'front' | 'middle' | 'rear';

export interface CoopDefenseMapPowerUpConfig {
  readonly defId: string;
  readonly region: CoopDefensePowerUpRegion;
  readonly respawnMs: number;
  readonly spawnOnArenaStart?: boolean;
}

export type CoopDefenseMapTrackMode = 'rails' | 'void-fire';

export interface CoopDefenseMapPermanentGroundFireConfig {
  readonly randomPatchCount: number;
  readonly minPatchRadiusCells: number;
  readonly maxPatchRadiusCells: number;
  /** Freier Chebyshev-Abstand um jede Basiszelle, damit Dauerfeuer keine Basis einschliesst. */
  readonly baseClearanceCells: number;
  readonly burnDurationMs: number;
  readonly burnDamagePerTick: number;
  readonly weaponName: string;
}

export interface CoopDefenseMapCorridorPoint {
  readonly gridX: number;
  readonly gridY: number;
}

/**
 * Ein Gang durch das Felsfeld: grober Streckenzug, an dem sich der Generator entlanghangelt.
 * Die Punkte geben nur den Verlauf vor – ausgehöhlt wird mit wandernder Mittellinie und
 * schwankendem Radius, damit der Gang nicht wie ein gezeichneter Korridor aussieht.
 */
export interface CoopDefenseMapCorridorConfig {
  readonly id: string;
  /** Abweichender mittlerer Radius; ohne Angabe gilt `corridorRadiusCells` des Felsfelds. */
  readonly radiusCells?: number;
  readonly points: readonly CoopDefenseMapCorridorPoint[];
}

/**
 * Ersetzt die prozeduralen Felsen durch ein durchgehend zugebautes Feld, in das nur die
 * konfigurierten Gänge gefräst werden. Die Schutzradien der Basen und die Gleisspalten bleiben
 * wie immer frei; Bäume entfallen, damit sie keinen Gang zustellen.
 *
 * Alle Streuwerte hängen am Arena-Seed: dieselbe Map sieht jede Runde etwas anders aus, bleibt
 * aber zwischen Host und Clients identisch.
 */
export interface CoopDefenseMapRockFieldConfig {
  /** Mittlerer Radius der Gänge in Zellen (Mitte der Schwankung). */
  readonly corridorRadiusCells: number;
  /** Maximale Abweichung des Radius nach oben und unten – erzeugt Engstellen und Kammern. */
  readonly corridorRadiusVarianceCells: number;
  /** Maximaler seitlicher Versatz der Mittellinie gegenüber dem konfigurierten Verlauf. */
  readonly corridorWanderCells: number;
  /** Zufällige Verschiebung der Zwischenpunkte; Anfangs- und Endpunkt bleiben fest. */
  readonly waypointJitterCells: number;
  /**
   * Globaler Multiplikator auf alle Gang-Radien (Standard 1 = unverändert). Das ist bei einem
   * Felsfeld das Äquivalent zu `rockFillRatio`: kleiner als 1 fräst schmalere Gänge (mehr Fels),
   * größer als 1 breitere Gänge (weniger Fels).
   */
  readonly rockDensityScale?: number;
  readonly corridors: readonly CoopDefenseMapCorridorConfig[];
}

export interface CoopDefenseMapConfig {
  readonly mapId: string;
  readonly displayName: string;
  /**
   * Horizontale Arenabreite im 32-px-Raster. Standard sind 60 Zellen; Werte werden auf
   * die gemeinsame CTB-Maximalbreite von 135 Zellen begrenzt.
   */
  readonly arenaWidthCells?: number;
  readonly tutorialText?: string;
  /** Anzeigedauer des Tutorial-Fensters; Standard ist COOP_DEFENSE_TUTORIAL_DURATION_MS. */
  readonly tutorialDurationMs?: number;
  /**
   * True: Das Tutorial-Fenster bleibt die komplette Runde stehen; `tutorialDurationMs`
   * wird dann ignoriert. Gedacht für die Einstiegs-Map, deren Text als Nachschlagewerk dient.
   */
  readonly tutorialPersistent?: boolean;
  /**
   * True: Unter dem Fließtext erscheint zusätzlich die Steuerungstabelle des Hilfe-Fensters.
   * Das Fenster wird dadurch deutlich höher (siehe `getCoopDefenseTutorialPanelHeight`) und
   * die Felsformation darunter entsprechend größer.
   */
  readonly tutorialShowControls?: boolean;
  /** True/Konfiguration: Die Zombie-Fraktion führt auf dieser Map eigene Luftangriffe durch. */
  readonly enemyAirstrikes?: boolean | CoopDefenseMapAirstrikeConfig;
  /**
   * Anteil der Zellen, die vor dem Cellular-Automata-Smoothing als Fels ausgewürfelt werden
   * (0…1, Standard entspricht dem globalen `ROCK_FILL_RATIO`). Steuert, wie voll die Map mit
   * Felsen wird. Wird ignoriert, wenn `rockField` gesetzt ist – dort steuert stattdessen
   * `rockField.rockDensityScale` die Fülle über die Gangbreite.
   */
  readonly rockFillRatio?: number;
  /** Gesetzt: zugebautes Felsfeld mit festen Gängen statt prozeduraler Felsverteilung. */
  readonly rockField?: CoopDefenseMapRockFieldConfig;
  /** Standard `rails`; `void-fire` reserviert denselben Korridor, erzeugt aber keine Gleise. */
  readonly trackMode?: CoopDefenseMapTrackMode;
  readonly permanentGroundFire?: CoopDefenseMapPermanentGroundFireConfig;
  /**
   * Uhrzeit, zu der die Map spielt, als `"HH:MM"` (Standard `"12:00"`). Sie steuert
   * Grundhelligkeit und Färbung der Arena, Länge und Deckkraft der statischen Schatten
   * sowie ob Spieler eine Taschenlampe tragen – stufenlos, ohne Sprung zwischen Tag und
   * Nacht und ohne Wechsel während der Runde. Die Kurve liegt in `effects/TimeOfDay.ts`.
   *
   * Wird auf Host und Clients lokal aus der bereits replizierten Map-ID abgeleitet und
   * braucht deshalb keinen eigenen Netzwerkpfad.
   */
  readonly timeOfDay?: string;
  /**
   * Multiplikator (0…1) auf die Armor-Drop-Chance von Felsen der Tutorial-Formation (siehe
   * `tutorialText`). Nur relevant, wenn die Map eine Tutorial-Formation erzeugt. Standard:
   * `DEFAULT_TUTORIAL_ROCK_ARMOR_DROP_MULT` – kann pro Map zum Finetuning überschrieben werden.
   */
  readonly tutorialRockArmorDropMult?: number;
  readonly roundDurationSec: number;
  readonly bases: readonly CoopBaseConfig[];
  readonly powerUps: readonly CoopDefenseMapPowerUpConfig[];
  readonly waves: readonly CoopDefenseMapWaveConfig[];
  readonly boss?: CoopDefenseMapBossConfig;
  /** Standard `survive`. */
  readonly objective?: CoopDefenseMapObjective;
  /** Gesetzt: Ein Sieg auf dieser Map bietet dem Spieler drei Items zur Auswahl an. */
  readonly itemDrop?: CoopDefenseMapItemDropConfig;
}

interface CoopDefenseMapRegistryFile {
  readonly defaultMapId: string;
  readonly maps: readonly CoopDefenseMapConfig[];
}

const COOP_DEFENSE_MAP_REGISTRY = normalizeMapRegistry(rawCoopDefenseMaps as CoopDefenseMapRegistryFile);

export const COOP_DEFENSE_MAP_CONFIGS = COOP_DEFENSE_MAP_REGISTRY.maps;
export const DEFAULT_COOP_DEFENSE_MAP_ID = COOP_DEFENSE_MAP_REGISTRY.defaultMapId;

const MAPS_BY_ID = new Map<string, CoopDefenseMapConfig>(
  COOP_DEFENSE_MAP_CONFIGS.map((mapConfig) => [mapConfig.mapId, mapConfig]),
);

export function getCoopDefenseMapConfig(mapId: string): CoopDefenseMapConfig {
  return MAPS_BY_ID.get(mapId) ?? getDefaultCoopDefenseMapConfig();
}

export function getDefaultCoopDefenseMapConfig(): CoopDefenseMapConfig {
  const mapConfig = MAPS_BY_ID.get(DEFAULT_COOP_DEFENSE_MAP_ID);
  if (!mapConfig) {
    throw new Error(`[coopDefenseMaps] Unknown default map id: ${DEFAULT_COOP_DEFENSE_MAP_ID}`);
  }
  return mapConfig;
}

export function resolveCoopDefenseMapWaveConfigs(
  mapConfig: CoopDefenseMapConfig,
  humanPlayerCount: number,
): readonly ResolvedCoopDefenseMapWaveConfig[] {
  return mapConfig.waves.map((waveConfig) => {
    const resolvedWaveConfig = resolveCoopDefenseEnemyWaveConfig(waveConfig.enemyKind, waveConfig, humanPlayerCount);
    return {
      enemyKind: waveConfig.enemyKind,
      intervalMs: resolvedWaveConfig.intervalMs,
      countPerWave: resolvedWaveConfig.countPerWave,
      startAtMs: Math.max(0, Math.floor(waveConfig.startAtMs ?? 0)),
      startsAfterAirstrikeBarrage: waveConfig.startsAfterAirstrikeBarrage ?? false,
    };
  });
}

/** Erwartete XP-Summe aller regulaer geplanten Spawns einer Map. */
export function getCoopDefenseMapScheduledXp(
  mapConfig: CoopDefenseMapConfig,
  waveConfigs: readonly ResolvedCoopDefenseMapWaveConfig[],
  humanPlayerCount = 1,
): number {
  const durationMs = mapConfig.roundDurationSec * 1000;
  let totalXp = 0;
  for (const wave of waveConfigs) totalXp += getScheduledWaveXp(wave, durationMs);
  for (const base of mapConfig.bases) {
    if (!base.spawnWave) continue;
    totalXp += getScheduledWaveXp(resolveWaveConfigForXp(base.spawnWave, humanPlayerCount), durationMs);
  }
  if (mapConfig.boss) totalXp += getEnemyLifecycleXp(mapConfig.boss.enemyKind);
  return Math.max(1, totalXp);
}

function getScheduledWaveXp(wave: ResolvedCoopDefenseMapWaveConfig, durationMs: number): number {
  const activeDurationMs = Math.max(0, durationMs - wave.startAtMs);
  if (activeDurationMs <= 0 || wave.countPerWave <= 0) return 0;
  const waveCount = Math.max(1, Math.ceil(activeDurationMs / wave.intervalMs));
  return waveCount * wave.countPerWave * getEnemyLifecycleXp(wave.enemyKind);
}

function resolveWaveConfigForXp(
  waveConfig: CoopDefenseMapWaveConfig,
  humanPlayerCount: number,
): ResolvedCoopDefenseMapWaveConfig {
  const resolved = resolveCoopDefenseEnemyWaveConfig(waveConfig.enemyKind, waveConfig, humanPlayerCount);
  return {
    enemyKind: waveConfig.enemyKind,
    intervalMs: resolved.intervalMs,
    countPerWave: resolved.countPerWave,
    startAtMs: waveConfig.startAtMs ?? 0,
    startsAfterAirstrikeBarrage: waveConfig.startsAfterAirstrikeBarrage ?? false,
  };
}

function getEnemyLifecycleXp(kind: CoopDefenseEnemyKind, ancestors = new Set<string>()): number {
  const config = getCoopDefenseEnemyConfig(kind);
  if (ancestors.has(kind)) return config.xp;
  const nextAncestors = new Set(ancestors).add(kind);
  return config.xp + (config.deathSpawns ?? []).reduce(
    (sum, spawn) => sum + Math.max(0, spawn.count) * getEnemyLifecycleXp(spawn.enemyKind, nextAncestors),
    0,
  );
}

function normalizeMapRegistry(registry: CoopDefenseMapRegistryFile): CoopDefenseMapRegistryFile {
  const maps = registry.maps.map(normalizeMapConfig);
  const uniqueMapIds = new Set<string>();
  for (const mapConfig of maps) {
    if (uniqueMapIds.has(mapConfig.mapId)) {
      throw new Error(`[coopDefenseMaps] Duplicate map id: ${mapConfig.mapId}`);
    }
    uniqueMapIds.add(mapConfig.mapId);
  }
  if (!uniqueMapIds.has(registry.defaultMapId)) {
    throw new Error(`[coopDefenseMaps] Default map id is missing from maps: ${registry.defaultMapId}`);
  }
  return {
    defaultMapId: registry.defaultMapId,
    maps,
  };
}

function normalizeMapConfig(mapConfig: CoopDefenseMapConfig): CoopDefenseMapConfig {
  const uniqueBaseIds = new Set<string>();
  const bases = mapConfig.bases.map((baseConfig) => {
    if (uniqueBaseIds.has(baseConfig.id)) {
      throw new Error(`[coopDefenseMaps] Duplicate base id in map ${mapConfig.mapId}: ${baseConfig.id}`);
    }
    uniqueBaseIds.add(baseConfig.id);
    return normalizeBaseConfig(baseConfig);
  });

  return {
    mapId: mapConfig.mapId,
    displayName: mapConfig.displayName,
    arenaWidthCells: normalizeCoopDefenseArenaWidthCells(
      mapConfig.arenaWidthCells ?? DEFAULT_COOP_DEFENSE_ARENA_WIDTH_CELLS,
    ),
    tutorialText: typeof mapConfig.tutorialText === 'string' && mapConfig.tutorialText.trim().length > 0
      ? mapConfig.tutorialText.trim()
      : undefined,
    tutorialDurationMs: typeof mapConfig.tutorialDurationMs === 'number' && Number.isFinite(mapConfig.tutorialDurationMs)
      ? Math.max(1000, Math.floor(mapConfig.tutorialDurationMs))
      : undefined,
    tutorialPersistent: mapConfig.tutorialPersistent === true,
    tutorialShowControls: mapConfig.tutorialShowControls === true,
    enemyAirstrikes: normalizeAirstrikeConfig(mapConfig.enemyAirstrikes),
    rockFillRatio: normalizeRockFillRatio(mapConfig.rockFillRatio),
    rockField: normalizeRockFieldConfig(mapConfig.mapId, mapConfig.rockField),
    trackMode: mapConfig.trackMode === 'void-fire' ? 'void-fire' : 'rails',
    permanentGroundFire: normalizePermanentGroundFire(mapConfig.permanentGroundFire),
    timeOfDay: normalizeTimeOfDayValue(mapConfig.mapId, mapConfig.timeOfDay),
    tutorialRockArmorDropMult: normalizeTutorialRockArmorDropMult(mapConfig.tutorialRockArmorDropMult),
    roundDurationSec: Math.max(1, Math.floor(mapConfig.roundDurationSec)),
    bases,
    powerUps: mapConfig.powerUps.map((powerUpConfig) => normalizePowerUpConfig(mapConfig.mapId, powerUpConfig)),
    waves: mapConfig.waves.map(normalizeWaveConfig),
    boss: normalizeBossConfig(mapConfig),
    objective: normalizeObjective(mapConfig.mapId, mapConfig.objective, bases, mapConfig.boss),
    itemDrop: normalizeItemDropConfig(mapConfig.mapId, mapConfig.itemDrop),
  };
}

function normalizeObjective(
  mapId: string,
  objective: CoopDefenseMapObjective | undefined,
  bases: readonly CoopBaseConfig[],
  boss: CoopDefenseMapBossConfig | undefined,
): CoopDefenseMapObjective {
  const normalizedObjective = objective ?? (boss ? 'defeat-boss' : 'survive');

  if (boss && normalizedObjective !== 'defeat-boss') {
    throw new Error(`[coopDefenseMaps] Boss map ${mapId} must use the defeat-boss objective`);
  }
  if (normalizedObjective === 'defeat-boss') {
    if (!boss) {
      throw new Error(`[coopDefenseMaps] Map ${mapId} wants defeat-boss but declares no boss`);
    }
    return normalizedObjective;
  }
  if (normalizedObjective !== 'destroy-hostile-bases') return 'survive';
  // Ohne feindliche Basis waere das Ziel sofort erfuellt und die Map in der ersten Sekunde gewonnen.
  if (!bases.some((baseConfig) => baseConfig.faction === 'hostile' && (baseConfig.role ?? 'main') === 'main')) {
    throw new Error(`[coopDefenseMaps] Map ${mapId} wants destroy-hostile-bases but declares no hostile main base`);
  }
  if (!bases.some((baseConfig) => baseConfig.faction !== 'hostile' && (baseConfig.role ?? 'main') === 'main')) {
    throw new Error(`[coopDefenseMaps] Map ${mapId} needs at least one friendly main base to lose`);
  }
  return normalizedObjective;
}

function normalizeItemDropConfig(
  mapId: string,
  itemDrop: CoopDefenseMapItemDropConfig | undefined,
): CoopDefenseMapItemDropConfig | undefined {
  if (!itemDrop) return undefined;
  if (typeof itemDrop.itemLevel !== 'number' || !Number.isFinite(itemDrop.itemLevel) || itemDrop.itemLevel < 1) {
    throw new Error(`[coopDefenseMaps] Item drop on map ${mapId} needs an itemLevel of at least 1`);
  }
  return { itemLevel: Math.floor(itemDrop.itemLevel) };
}

function normalizePermanentGroundFire(
  config: CoopDefenseMapPermanentGroundFireConfig | undefined,
): CoopDefenseMapPermanentGroundFireConfig | undefined {
  if (!config) return undefined;
  const minPatchRadiusCells = Math.max(0.5, config.minPatchRadiusCells);
  return {
    randomPatchCount: Math.max(0, Math.floor(config.randomPatchCount)),
    minPatchRadiusCells,
    maxPatchRadiusCells: Math.max(minPatchRadiusCells, config.maxPatchRadiusCells),
    baseClearanceCells: Math.max(1, Math.floor(config.baseClearanceCells ?? 2)),
    burnDurationMs: Math.max(1, Math.floor(config.burnDurationMs)),
    burnDamagePerTick: Math.max(0, config.burnDamagePerTick),
    weaponName: config.weaponName || 'Leerenbrand',
  };
}

/**
 * Prüft `"HH:MM"` und schreibt den Standard aus, wenn nichts gesetzt ist.
 *
 * Bewusst mit Wurf statt stillem Rückfall: eine vertippte Uhrzeit wäre sonst als
 * unauffällig helle Map kaum von einer bewusst hellen zu unterscheiden.
 */
function normalizeTimeOfDayValue(mapId: string, timeOfDay: string | undefined): string {
  if (timeOfDay === undefined) return DEFAULT_MAP_TIME_OF_DAY;
  const minutes = parseTimeOfDay(timeOfDay);
  if (minutes === null) {
    throw new Error(`[coopDefenseMaps] Invalid timeOfDay in map ${mapId}: ${timeOfDay} (expected "HH:MM")`);
  }
  return formatTimeOfDay(minutes);
}

function normalizeAirstrikeConfig(
  enemyAirstrikes: boolean | CoopDefenseMapAirstrikeConfig | undefined,
): CoopDefenseMapAirstrikeConfig | undefined {
  if (!enemyAirstrikes) return undefined;
  const config = enemyAirstrikes === true ? {} : enemyAirstrikes;
  return {
    bombTutorialRock: config.bombTutorialRock ?? true,
    huntIntervalMs: Math.max(1, Math.floor(config.huntIntervalMs ?? DEFAULT_AIRSTRIKE_HUNT_INTERVAL_MS)),
  };
}

function normalizeRockFieldConfig(
  mapId: string,
  rockField: CoopDefenseMapRockFieldConfig | undefined,
): CoopDefenseMapRockFieldConfig | undefined {
  if (!rockField) return undefined;

  const densityScale = typeof rockField.rockDensityScale === 'number' && Number.isFinite(rockField.rockDensityScale) && rockField.rockDensityScale > 0
    ? rockField.rockDensityScale
    : 1;

  const uniqueCorridorIds = new Set<string>();
  const corridors = rockField.corridors.map((corridor) => {
    if (uniqueCorridorIds.has(corridor.id)) {
      throw new Error(`[coopDefenseMaps] Duplicate corridor id on map ${mapId}: ${corridor.id}`);
    }
    uniqueCorridorIds.add(corridor.id);
    if (corridor.points.length < 2) {
      throw new Error(`[coopDefenseMaps] Corridor ${mapId}:${corridor.id} needs at least two points`);
    }

    return {
      id: corridor.id,
      radiusCells: typeof corridor.radiusCells === 'number' && Number.isFinite(corridor.radiusCells)
        ? clampCorridorRadius(corridor.radiusCells * densityScale)
        : undefined,
      points: corridor.points.map((point) => ({
        gridX: Math.floor(point.gridX),
        gridY: Math.floor(point.gridY),
      })),
    };
  });

  if (corridors.length === 0) {
    throw new Error(`[coopDefenseMaps] Rock field on map ${mapId} needs at least one corridor`);
  }

  return {
    corridorRadiusCells: clampCorridorRadius(rockField.corridorRadiusCells * densityScale),
    corridorRadiusVarianceCells: Math.max(0, rockField.corridorRadiusVarianceCells),
    corridorWanderCells: Math.max(0, rockField.corridorWanderCells),
    waypointJitterCells: Math.max(0, rockField.waypointJitterCells),
    corridors,
  };
}

function clampCorridorRadius(radiusCells: number): number {
  return Math.max(MIN_CORRIDOR_RADIUS_CELLS, radiusCells);
}

function normalizeRockFillRatio(rockFillRatio: number | undefined): number {
  if (typeof rockFillRatio !== 'number' || !Number.isFinite(rockFillRatio)) return ROCK_FILL_RATIO;
  return Math.max(0, Math.min(MAX_ROCK_FILL_RATIO, rockFillRatio));
}

function normalizeTutorialRockArmorDropMult(mult: number | undefined): number {
  if (typeof mult !== 'number' || !Number.isFinite(mult)) return DEFAULT_TUTORIAL_ROCK_ARMOR_DROP_MULT;
  return Math.max(0, Math.min(1, mult));
}

function normalizePowerUpConfig(
  mapId: string,
  powerUpConfig: CoopDefenseMapPowerUpConfig,
): CoopDefenseMapPowerUpConfig {
  if (!TIMED_POWERUP_PEDESTAL_CONFIGS[powerUpConfig.defId]) {
    throw new Error(`[coopDefenseMaps] Unknown pedestal power-up on map ${mapId}: ${powerUpConfig.defId}`);
  }
  if (
    powerUpConfig.region !== 'front'
    && powerUpConfig.region !== 'middle'
    && powerUpConfig.region !== 'rear'
  ) {
    throw new Error(`[coopDefenseMaps] Unknown power-up region on map ${mapId}: ${powerUpConfig.region}`);
  }

  return {
    defId: powerUpConfig.defId,
    region: powerUpConfig.region,
    respawnMs: Math.max(1, Math.floor(powerUpConfig.respawnMs)),
    // Coop-Podeste durchlaufen auch vor ihrem ersten Spawn den vollen Timer.
    spawnOnArenaStart: shouldDelayFirstPedestalSpawn(powerUpConfig.defId)
      ? false
      : (powerUpConfig.spawnOnArenaStart ?? false),
  };
}

function normalizeBossConfig(mapConfig: CoopDefenseMapConfig): CoopDefenseMapBossConfig | undefined {
  const bossWaves = mapConfig.waves.filter((wave) => getCoopDefenseEnemyConfig(wave.enemyKind).isBoss);
  if (bossWaves.length > 0) {
    throw new Error(`[coopDefenseMaps] Boss enemies must use the unique boss slot on map ${mapConfig.mapId}`);
  }
  if (!mapConfig.boss) return undefined;

  const enemyConfig = getCoopDefenseEnemyConfig(mapConfig.boss.enemyKind);
  if (!enemyConfig.isBoss) {
    throw new Error(
      `[coopDefenseMaps] Boss slot on map ${mapConfig.mapId} references non-boss enemy ${mapConfig.boss.enemyKind}`,
    );
  }

  return {
    enemyKind: mapConfig.boss.enemyKind,
    spawnAtMs: Math.max(0, Math.min(
      mapConfig.roundDurationSec * 1000 - 1,
      Math.floor(mapConfig.boss.spawnAtMs),
    )),
  };
}

function normalizeBaseConfig(baseConfig: CoopBaseConfig): CoopBaseConfig {
  const uniqueTurretIds = new Set<string>();
  const turrets = (baseConfig.turrets ?? []).map((turret) => {
    if (uniqueTurretIds.has(turret.id)) {
      throw new Error(`[coopDefenseMaps] Duplicate turret id on base ${baseConfig.id}: ${turret.id}`);
    }
    uniqueTurretIds.add(turret.id);
    return normalizeBaseTurretConfig(baseConfig.id, turret);
  });
  const uniquePedestalIds = new Set<string>();
  const powerUpPedestals = (baseConfig.powerUpPedestals ?? []).map((pedestal) => {
    if (uniquePedestalIds.has(pedestal.id)) {
      throw new Error(`[coopDefenseMaps] Duplicate power-up pedestal id on base ${baseConfig.id}: ${pedestal.id}`);
    }
    uniquePedestalIds.add(pedestal.id);
    return normalizeBasePowerUpPedestalConfig(baseConfig.id, pedestal);
  });

  const faction: CoopBaseFaction = baseConfig.faction === 'hostile' ? 'hostile' : 'friendly';
  const role: CoopBaseRole = baseConfig.role === 'outpost' || baseConfig.role === 'spawn-point'
    ? baseConfig.role
    : 'main';
  const spawnCenter = baseConfig.spawnCenter
    ? normalizeBaseCellOffset(baseConfig.spawnCenter)
    : undefined;
  const spawnWave = baseConfig.spawnWave ? normalizeWaveConfig(baseConfig.spawnWave) : undefined;

  if (role === 'spawn-point' && (!spawnCenter || !spawnWave)) {
    throw new Error(`[coopDefenseMaps] Spawn point ${baseConfig.id} needs spawnCenter and spawnWave`);
  }
  if (role !== 'spawn-point' && (spawnCenter || spawnWave)) {
    throw new Error(`[coopDefenseMaps] Only spawn points may declare spawnCenter or spawnWave: ${baseConfig.id}`);
  }
  // Podeste versorgen ausschliesslich Spieler und bleiben deshalb an Gegnerbasen verboten.
  // Basistuerme sind dagegen fraktionsfaehig und erhalten ihr Zielverhalten erst zur Laufzeit.
  if (faction === 'hostile' && powerUpPedestals.length > 0) {
    throw new Error(
      `[coopDefenseMaps] Hostile base ${baseConfig.id} must not declare power-up pedestals`,
    );
  }

  return {
    id: baseConfig.id,
    hpMax: Math.max(1, Math.floor(baseConfig.hpMax)),
    playerScaling: normalizeBasePlayerScaling(baseConfig.playerScaling),
    faction,
    role,
    anchor: normalizeBaseAnchor(baseConfig.anchor),
    shape: normalizeBaseShape(baseConfig.shape),
    turrets,
    powerUpPedestals,
    spawnCenter,
    spawnWave,
  };
}

function normalizeBasePlayerScaling(
  scaling: CoopBasePlayerScaling | undefined,
): CoopBasePlayerScaling | undefined {
  if (!scaling) return undefined;
  return {
    maxHpFactorPerAdditionalPlayer: normalizeCoopDefensePlayerScalingFactor(
      scaling.maxHpFactorPerAdditionalPlayer,
    ),
  };
}

function normalizeBaseCellOffset(cell: CoopBaseCellOffset): CoopBaseCellOffset {
  return {
    gridX: Math.floor(cell.gridX),
    gridY: Math.floor(cell.gridY),
  };
}

function normalizeBasePowerUpPedestalConfig(
  baseId: string,
  pedestal: CoopBasePowerUpPedestalConfig,
): CoopBasePowerUpPedestalConfig {
  if (!TIMED_POWERUP_PEDESTAL_CONFIGS[pedestal.defId]) {
    throw new Error(`[coopDefenseMaps] Unknown pedestal power-up on base ${baseId}: ${pedestal.defId}`);
  }

  return {
    id: pedestal.id,
    cellOffset: {
      gridX: Math.floor(pedestal.cellOffset.gridX),
      gridY: Math.floor(pedestal.cellOffset.gridY),
    },
    defId: pedestal.defId,
    respawnMs: Math.max(1, Math.floor(pedestal.respawnMs)),
    // Auch gekoppelte Coop-Podeste starten standardmäßig erst nach ihrem ersten Timer.
    spawnOnArenaStart: shouldDelayFirstPedestalSpawn(pedestal.defId)
      ? false
      : (pedestal.spawnOnArenaStart ?? false),
  };
}

function normalizeBaseTurretConfig(baseId: string, turret: CoopBaseTurretConfig): CoopBaseTurretConfig {
  if (
    turret.mountSide !== 'front'
    && turret.mountSide !== 'rear'
    && turret.mountSide !== 'top'
    && turret.mountSide !== 'bottom'
  ) {
    throw new Error(`[coopDefenseMaps] Unknown turret mount side on base ${baseId}: ${turret.mountSide}`);
  }
  if (
    turret.weaponId !== 'SPOREN'
    && turret.weaponId !== 'BASE_SPOREN'
    && turret.weaponId !== 'FLIEGENPILZ_PLASMA'
    && turret.weaponId !== 'TURRET_ROCKET'
    && turret.weaponId !== 'TURRET_MG'
    && turret.weaponId !== 'TURRET_FLAME'
    && turret.weaponId !== 'TURRET_VOID_FLAME'
    && turret.weaponId !== 'TURRET_SPORE'
  ) {
    throw new Error(`[coopDefenseMaps] Unsupported base turret weapon on base ${baseId}: ${turret.weaponId}`);
  }

  return {
    id: turret.id,
    cellOffset: {
      gridX: Math.max(0, Math.floor(turret.cellOffset.gridX)),
      gridY: Math.max(0, Math.floor(turret.cellOffset.gridY)),
    },
    mountSide: turret.mountSide,
    weaponId: turret.weaponId,
  };
}

function normalizeBaseAnchor(anchor: CoopBaseAnchor): CoopBaseAnchor {
  switch (anchor.kind) {
    case 'right-center':
    case 'left-center':
      return {
        kind: anchor.kind,
        edgeInsetCells: Math.max(0, Math.floor(anchor.edgeInsetCells)),
      };
    case 'center-offset':
      return {
        kind: 'center-offset',
        dxCells: Math.floor(anchor.dxCells),
        dyCells: Math.floor(anchor.dyCells),
      };
    case 'grid':
      return {
        kind: 'grid',
        gridX: Math.floor(anchor.gridX),
        gridY: Math.floor(anchor.gridY),
      };
  }
}

function normalizeBaseShape(shape: CoopBaseShape): CoopBaseShape {
  if (shape.kind === 'rectangle') {
    return {
      kind: 'rectangle',
      widthCells: Math.max(1, Math.floor(shape.widthCells)),
      heightCells: Math.max(1, Math.floor(shape.heightCells)),
    };
  }

  return {
    kind: 'cells',
    cells: shape.cells.map((cell) => ({
      gridX: Math.max(0, Math.floor(cell.gridX)),
      gridY: Math.max(0, Math.floor(cell.gridY)),
    })),
  };
}

function normalizeWaveConfig(waveConfig: CoopDefenseMapWaveConfig): CoopDefenseMapWaveConfig {
  return {
    enemyKind: waveConfig.enemyKind,
    intervalMs: Math.max(1, Math.floor(waveConfig.intervalMs)),
    countPerWave: Math.max(0, Math.floor(waveConfig.countPerWave)),
    startAtMs: Math.max(0, Math.floor(waveConfig.startAtMs ?? 0)),
    startsAfterAirstrikeBarrage: waveConfig.startsAfterAirstrikeBarrage ?? false,
  };
}
