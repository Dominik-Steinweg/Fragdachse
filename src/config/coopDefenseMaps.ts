import { COOP_DEFENSE_MAP_REGISTRY } from './coopDefenseMaps/index';
import {
  getCoopDefenseEnemyConfig,
  hasCoopDefenseEnemyKind,
  resolveCoopDefenseEnemySpawnConfig,
  type CoopDefenseEnemyKind,
} from './coopDefenseEnemies';
import { shouldDelayFirstPedestalSpawn, TIMED_POWERUP_PEDESTAL_CONFIGS } from '../powerups/PowerUpConfig';
import {
  DEFAULT_COOP_DEFENSE_ARENA_HEIGHT_CELLS,
  DEFAULT_COOP_DEFENSE_ARENA_WIDTH_CELLS,
  normalizeCoopDefenseArenaHeightCells,
  normalizeCoopDefenseArenaWidthCells,
  ROCK_FILL_RATIO,
} from '../config';
import { DEFAULT_TIME_OF_DAY_MINUTES, formatTimeOfDay, parseTimeOfDay } from '../effects/TimeOfDay';
import { normalizeCoopDefensePlayerScalingFactor } from './coopDefenseScaling';
import type { SpawnFront } from '../types';
import { DEFAULT_SPAWN_FRONT, isSpawnFront } from '../utils/spawnFront';

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
  /** Freie Zelle innerhalb der Shape, an der die strukturgebundene Quelle erscheint. */
  readonly spawnCenter?: CoopBaseCellOffset;
}

export type CoopDefenseMapPersistentSpawnSource =
  | { readonly type: 'map' }
  | { readonly type: 'base'; readonly baseId: string };

export interface CoopDefenseMapPersistentSpawnConfig {
  readonly id: string;
  readonly enemyKind: CoopDefenseEnemyKind;
  readonly intervalMs: number;
  readonly countPerTick: number;
  readonly startAtMs?: number;
  readonly source: CoopDefenseMapPersistentSpawnSource;
  readonly front?: SpawnFront;
}

export interface ResolvedCoopDefenseMapPersistentSpawnConfig {
  readonly id: string;
  readonly enemyKind: CoopDefenseEnemyKind;
  readonly intervalMs: number;
  readonly countPerTick: number;
  readonly startAtMs: number;
  readonly source: CoopDefenseMapPersistentSpawnSource;
  readonly front?: SpawnFront;
}

/** Eine endliche Gegnergruppe innerhalb eines Encounters. */
export interface CoopDefenseMapEncounterGroupConfig {
  readonly enemyKind: CoopDefenseEnemyKind;
  readonly count: number;
  /** Verzögerung relativ zum Start des Encounters; Standard 0. */
  readonly delayMs?: number;
  readonly front?: SpawnFront;
}

/** Kleine, bewusst typisierte Startbedingungen fuer einen endlichen Encounter. */
export type CoopDefenseMapEncounterStart =
  | { readonly type: 'time'; readonly atMs: number }
  | { readonly type: 'after-previous' }
  | { readonly type: 'opening-airstrike-complete' }
  | { readonly type: 'boss-phase'; readonly phase: number }
  | { readonly type: 'base-destroyed'; readonly baseId: string };

/** Endlicher Encounter; `repel-assault` verwendet die Reihenfolge als Clear-/Rest-Kette. */
export interface CoopDefenseMapEncounterConfig {
  readonly id: string;
  readonly start: CoopDefenseMapEncounterStart;
  /** Authored pause after this encounter is cleared; ignored after the final encounter. */
  readonly restAfterMs?: number;
  readonly groups: readonly CoopDefenseMapEncounterGroupConfig[];
}

export interface ResolvedCoopDefenseMapEncounterGroupConfig {
  readonly enemyKind: CoopDefenseEnemyKind;
  readonly count: number;
  readonly delayMs: number;
  readonly front?: SpawnFront;
}

export interface ResolvedCoopDefenseMapEncounterConfig {
  readonly id: string;
  readonly start: CoopDefenseMapEncounterStart;
  readonly restAfterMs: number;
  readonly groups: readonly ResolvedCoopDefenseMapEncounterGroupConfig[];
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
 * Jede Map hat genau ein Ziel: einen endlichen Assault abwehren, Zeit ueberleben, den Boss
 * besiegen oder alle feindlichen Basen zerstoeren. Verloren wird in allen Faellen ueber die
 * eigenen Basen.
 */
export type CoopDefenseMapObjective = 'repel-assault' | 'survive' | 'defeat-boss' | 'destroy-hostile-bases';

export function getCoopDefenseMapObjectiveLabel(objective: CoopDefenseMapObjective): string {
  switch (objective) {
    case 'repel-assault':
      return 'ANGRIFF ABWEHREN';
    case 'defeat-boss':
      return 'BOSS MUSS FALLEN';
    case 'destroy-hostile-bases':
      return 'FEINDBASIS ZERSTÖREN';
    case 'survive':
      return 'ZEIT ÜBERLEBEN';
    default:
      throw new Error(`[coopDefenseMaps] Unknown objective: ${objective}`);
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

/**
 * Startbedingung der ersten Zugeinfahrt. Bewusst als getaggte Union wie
 * {@link CoopDefenseMapEncounterStart}, damit später semantische Auslöser (`boss-phase`,
 * `base-destroyed`) ergänzt werden können – ohne dafür jetzt eine allgemeine Trigger-Engine
 * zu bauen.
 */
export type CoopDefenseMapTrainArrival =
  | { readonly type: 'time'; readonly atMs: number };

/**
 * Der Zug als eigenständiges Umgebungs-Event der Map – unabhängig von den Gleisen.
 * `trackMode` entscheidet nur, ob der Korridor Gleise bekommt; erst dieses Feld schickt
 * einen Zug darüber. Maps mit Gleisen, aber ohne `train`, sind damit möglich.
 */
export interface CoopDefenseMapTrainConfig {
  readonly firstArrival: CoopDefenseMapTrainArrival;
  /** Pause zwischen Verlassen der Arena und nächster Einfahrt; fehlt = nur eine Einfahrt. */
  readonly repeatAfterExitMs?: number;
}

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
  /** Vertikale Arenahoehe im 32-px-Raster; ohne Angabe bleibt die bestehende Hoehe aktiv. */
  readonly arenaHeightCells?: number;
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
  /** Gesetzt: Auf dieser Map fährt der Zug RB 54. Ohne dieses Feld bleiben die Gleise leer. */
  readonly train?: CoopDefenseMapTrainConfig;
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
  /** Echte Rundendauer; nur fuer `survive` gesetzt und siegrelevant. */
  readonly surviveDurationSec?: number;
  /** Explizite, reine Balancing-Referenz fuer Druck-/Drop-Normalisierung. */
  readonly balanceReferenceDurationSec: number;
  readonly bases: readonly CoopBaseConfig[];
  readonly powerUps: readonly CoopDefenseMapPowerUpConfig[];
  /** Optionale, zeitlich unbegrenzte Quellen fuer den Hintergrunddruck. */
  readonly persistentSpawns?: readonly CoopDefenseMapPersistentSpawnConfig[];
  /** Optionale endliche Encounter; beide Modelle koennen parallel aktiv sein. */
  readonly encounters?: readonly CoopDefenseMapEncounterConfig[];
  readonly boss?: CoopDefenseMapBossConfig;
  /** Jede Map muss ihr Ziel explizit konfigurieren. */
  readonly objective: CoopDefenseMapObjective;
  /** Fuer jede Survival-Map zwingend: begrenzte persoenliche Respawns. */
  readonly surviveRespawnsPerPlayer?: number;
  /** Gesetzt: Ein Sieg auf dieser Map bietet dem Spieler drei Items zur Auswahl an. */
  readonly itemDrop?: CoopDefenseMapItemDropConfig;
}

interface CoopDefenseMapRegistryFile {
  readonly defaultMapId: string;
  readonly maps: readonly CoopDefenseMapConfig[];
}

const NORMALIZED_COOP_DEFENSE_MAP_REGISTRY = normalizeMapRegistry(
  COOP_DEFENSE_MAP_REGISTRY as CoopDefenseMapRegistryFile,
);

export const COOP_DEFENSE_MAP_CONFIGS = NORMALIZED_COOP_DEFENSE_MAP_REGISTRY.maps;
export const DEFAULT_COOP_DEFENSE_MAP_ID = NORMALIZED_COOP_DEFENSE_MAP_REGISTRY.defaultMapId;

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

export function resolveCoopDefenseMapPersistentSpawnConfigs(
  mapConfig: CoopDefenseMapConfig,
  humanPlayerCount: number,
): readonly ResolvedCoopDefenseMapPersistentSpawnConfig[] {
  return (mapConfig.persistentSpawns ?? []).map((spawnConfig) => {
    const resolvedSpawnConfig = resolveCoopDefenseEnemySpawnConfig(
      spawnConfig.enemyKind,
      { intervalMs: spawnConfig.intervalMs, countPerTick: spawnConfig.countPerTick },
      humanPlayerCount,
    );
    return {
      id: spawnConfig.id,
      enemyKind: spawnConfig.enemyKind,
      intervalMs: resolvedSpawnConfig.intervalMs,
      countPerTick: resolvedSpawnConfig.countPerTick,
      startAtMs: Math.max(0, Math.floor(spawnConfig.startAtMs ?? 0)),
      source: spawnConfig.source,
      ...(spawnConfig.source.type === 'map'
        ? { front: normalizeSpawnFront(mapConfig.mapId, spawnConfig.id, spawnConfig.front) }
        : {}),
    };
  });
}

/** Loest Encounter-Gruppenzahlen ueber denselben zentralen Enemy-Spawn-Resolver auf. */
export function resolveCoopDefenseMapEncounterConfigs(
  mapConfig: CoopDefenseMapConfig,
  humanPlayerCount: number,
): readonly ResolvedCoopDefenseMapEncounterConfig[] {
  return (mapConfig.encounters ?? []).map((encounter) => ({
    id: encounter.id,
    start: encounter.start,
    restAfterMs: Math.max(0, Math.floor(encounter.restAfterMs ?? 0)),
    groups: encounter.groups.map((group) => {
      const resolvedGroup = resolveCoopDefenseEnemySpawnConfig(
        group.enemyKind,
        { intervalMs: 1, countPerTick: group.count },
        humanPlayerCount,
      );
      return {
        enemyKind: group.enemyKind,
        count: resolvedGroup.countPerTick,
        delayMs: Math.max(0, Math.floor(group.delayMs ?? 0)),
        front: group.front ?? DEFAULT_SPAWN_FRONT,
      };
    }),
  }));
}

/** Exakte XP-Untergrenze aus endlichem Map-Inhalt; persistenter Druck ist darin nicht enthalten. */
export function getCoopDefenseMapScheduledXp(
  mapConfig: CoopDefenseMapConfig,
  humanPlayerCount = 1,
): number {
  let totalXp = 0;
  if ((mapConfig.encounters?.length ?? 0) > 0) {
    for (const encounter of resolveCoopDefenseMapEncounterConfigs(mapConfig, humanPlayerCount)) {
      totalXp += getEncounterXp(encounter);
    }
  }
  if (mapConfig.boss) totalXp += getEnemyLifecycleXp(mapConfig.boss.enemyKind);
  return totalXp;
}

/**
 * Technische XP-Referenz fuer Drop-Chancen. Persistente Quellen werden ueber eine explizite
 * Balancing-Referenz geschaetzt; diese ist kein Gameplay-Timer und kein garantierter Rundenertrag.
 */
export function getCoopDefenseMapXpReference(
  mapConfig: CoopDefenseMapConfig,
  persistentSpawns: readonly ResolvedCoopDefenseMapPersistentSpawnConfig[],
  humanPlayerCount = 1,
): number {
  const durationMs = mapConfig.balanceReferenceDurationSec * 1000;
  const finiteXp = getCoopDefenseMapScheduledXp(mapConfig, humanPlayerCount);
  const persistentEstimate = persistentSpawns.reduce(
    (sum, spawn) => sum + getScheduledPersistentSpawnXp(spawn, durationMs),
    0,
  );
  return Math.max(1, finiteXp + persistentEstimate);
}

function getEncounterXp(encounter: ResolvedCoopDefenseMapEncounterConfig): number {
  return encounter.groups.reduce(
    (sum, group) => sum + group.count * getEnemyLifecycleXp(group.enemyKind),
    0,
  );
}

function getScheduledPersistentSpawnXp(
  spawn: ResolvedCoopDefenseMapPersistentSpawnConfig,
  durationMs: number,
): number {
  const activeDurationMs = Math.max(0, durationMs - spawn.startAtMs);
  if (activeDurationMs <= 0 || spawn.countPerTick <= 0) return 0;
  const tickCount = Math.max(1, Math.ceil(activeDurationMs / spawn.intervalMs));
  return tickCount * spawn.countPerTick * getEnemyLifecycleXp(spawn.enemyKind);
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
  const maps = registry.maps.map(normalizeCoopDefenseMapConfig);
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

export function normalizeCoopDefenseMapConfig(mapConfig: CoopDefenseMapConfig): CoopDefenseMapConfig {
  const uniqueBaseIds = new Set<string>();
  const bases = mapConfig.bases.map((baseConfig) => {
    if (uniqueBaseIds.has(baseConfig.id)) {
      throw new Error(`[coopDefenseMaps] Duplicate base id in map ${mapConfig.mapId}: ${baseConfig.id}`);
    }
    uniqueBaseIds.add(baseConfig.id);
    return normalizeBaseConfig(baseConfig);
  });
  const boss = normalizeBossConfig(mapConfig);
  const objective = normalizeObjective(mapConfig.mapId, mapConfig.objective, bases, boss);
  const persistentSpawns = Array.isArray(mapConfig.persistentSpawns) ? mapConfig.persistentSpawns : [];
  validateMapSpawnModel(mapConfig.mapId, objective, mapConfig.encounters);
  validateFriendlyMainBase(mapConfig.mapId, bases);
  const surviveDurationSec = normalizeSurviveDurationSec(mapConfig.mapId, objective, mapConfig.surviveDurationSec);
  const balanceReferenceDurationSec = normalizeBalanceReferenceDurationSec(
    mapConfig.mapId,
    mapConfig.balanceReferenceDurationSec,
  );
  const enemyAirstrikes = normalizeAirstrikeConfig(mapConfig.enemyAirstrikes);
  const encounters = normalizeEncounterConfigs(mapConfig.mapId, mapConfig.encounters, {
    bases,
    airstrikes: enemyAirstrikes,
    boss,
  });
  const trackMode: CoopDefenseMapTrackMode = mapConfig.trackMode === 'void-fire' ? 'void-fire' : 'rails';

  return {
    mapId: mapConfig.mapId,
    displayName: mapConfig.displayName,
    arenaWidthCells: normalizeCoopDefenseArenaWidthCells(
      mapConfig.arenaWidthCells ?? DEFAULT_COOP_DEFENSE_ARENA_WIDTH_CELLS,
    ),
    arenaHeightCells: normalizeCoopDefenseArenaHeightCells(
      mapConfig.arenaHeightCells ?? DEFAULT_COOP_DEFENSE_ARENA_HEIGHT_CELLS,
    ),
    tutorialText: typeof mapConfig.tutorialText === 'string' && mapConfig.tutorialText.trim().length > 0
      ? mapConfig.tutorialText.trim()
      : undefined,
    tutorialDurationMs: typeof mapConfig.tutorialDurationMs === 'number' && Number.isFinite(mapConfig.tutorialDurationMs)
      ? Math.max(1000, Math.floor(mapConfig.tutorialDurationMs))
      : undefined,
    tutorialPersistent: mapConfig.tutorialPersistent === true,
    tutorialShowControls: mapConfig.tutorialShowControls === true,
    enemyAirstrikes,
    rockFillRatio: normalizeRockFillRatio(mapConfig.rockFillRatio),
    rockField: normalizeRockFieldConfig(mapConfig.mapId, mapConfig.rockField),
    trackMode,
    train: normalizeTrainConfig(mapConfig.mapId, mapConfig.train, trackMode),
    permanentGroundFire: normalizePermanentGroundFire(mapConfig.permanentGroundFire),
    timeOfDay: normalizeTimeOfDayValue(mapConfig.mapId, mapConfig.timeOfDay),
    tutorialRockArmorDropMult: normalizeTutorialRockArmorDropMult(mapConfig.tutorialRockArmorDropMult),
    surviveDurationSec,
    balanceReferenceDurationSec,
    bases,
    powerUps: mapConfig.powerUps.map((powerUpConfig) => normalizePowerUpConfig(mapConfig.mapId, powerUpConfig)),
    persistentSpawns: normalizePersistentSpawnConfigs(mapConfig.mapId, persistentSpawns, bases),
    encounters,
    boss,
    objective,
    surviveRespawnsPerPlayer: normalizeSurviveRespawnsPerPlayer(
      mapConfig.mapId,
      objective,
      mapConfig.surviveRespawnsPerPlayer,
    ),
    itemDrop: normalizeItemDropConfig(mapConfig.mapId, mapConfig.itemDrop),
  };
}

function validateMapSpawnModel(
  mapId: string,
  objective: CoopDefenseMapObjective,
  encounters: readonly CoopDefenseMapEncounterConfig[] | undefined,
): void {
  if (objective !== 'repel-assault') return;
  if (!Array.isArray(encounters) || encounters.length === 0) {
    throw new Error(`[coopDefenseMaps] Map ${mapId} with repel-assault needs at least one encounter`);
  }
}

function validateFriendlyMainBase(mapId: string, bases: readonly CoopBaseConfig[]): void {
  if (!bases.some((baseConfig) => baseConfig.faction !== 'hostile' && (baseConfig.role ?? 'main') === 'main')) {
    throw new Error(`[coopDefenseMaps] Map ${mapId} needs at least one friendly main base`);
  }
}

function normalizeSurviveDurationSec(
  mapId: string,
  objective: CoopDefenseMapObjective,
  value: number | undefined,
): number | undefined {
  if (objective !== 'survive') {
    if (value !== undefined) {
      throw new Error(`[coopDefenseMaps] Only survive maps may declare surviveDurationSec: ${mapId}`);
    }
    return undefined;
  }
  if (value === undefined || !Number.isFinite(value) || value <= 0) {
    throw new Error(`[coopDefenseMaps] Survive map ${mapId} needs a positive surviveDurationSec`);
  }
  const normalized = Math.floor(value);
  if (normalized <= 0) {
    throw new Error(`[coopDefenseMaps] Survive map ${mapId} needs a positive surviveDurationSec`);
  }
  return normalized;
}

function normalizeBalanceReferenceDurationSec(mapId: string, value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`[coopDefenseMaps] Map ${mapId} needs a positive balanceReferenceDurationSec`);
  }
  const normalized = Math.floor(value);
  if (normalized <= 0) {
    throw new Error(`[coopDefenseMaps] Map ${mapId} needs a positive balanceReferenceDurationSec`);
  }
  return normalized;
}

function normalizeSurviveRespawnsPerPlayer(
  mapId: string,
  objective: CoopDefenseMapObjective,
  value: number | undefined,
): number | undefined {
  if (objective !== 'survive') {
    if (value !== undefined) {
      throw new Error(`[coopDefenseMaps] Only survive maps may declare surviveRespawnsPerPlayer: ${mapId}`);
    }
    return undefined;
  }
  if (value === undefined || !Number.isFinite(value) || value < 0) {
    throw new Error(`[coopDefenseMaps] Invalid surviveRespawnsPerPlayer on map ${mapId}: ${value}`);
  }
  return Math.floor(value);
}

function normalizeObjective(
  mapId: string,
  objective: CoopDefenseMapObjective,
  bases: readonly CoopBaseConfig[],
  boss: CoopDefenseMapBossConfig | undefined,
): CoopDefenseMapObjective {
  if (
    objective !== 'repel-assault'
    && objective !== 'survive'
    && objective !== 'defeat-boss'
    && objective !== 'destroy-hostile-bases'
  ) {
    throw new Error(`[coopDefenseMaps] Map ${mapId} needs a valid explicit objective`);
  }
  const normalizedObjective = objective;

  if (boss && normalizedObjective !== 'defeat-boss') {
    throw new Error(`[coopDefenseMaps] Boss map ${mapId} must use the defeat-boss objective`);
  }
  if (normalizedObjective === 'defeat-boss') {
    if (!boss) {
      throw new Error(`[coopDefenseMaps] Map ${mapId} wants defeat-boss but declares no boss`);
    }
    return normalizedObjective;
  }
  if (normalizedObjective === 'repel-assault') return normalizedObjective;
  if (normalizedObjective === 'survive') return normalizedObjective;
  // Ohne feindliche Basis waere das Ziel sofort erfuellt und die Map in der ersten Sekunde gewonnen.
  if (!bases.some((baseConfig) => baseConfig.faction === 'hostile' && (baseConfig.role ?? 'main') === 'main')) {
    throw new Error(`[coopDefenseMaps] Map ${mapId} wants destroy-hostile-bases but declares no hostile main base`);
  }
  if (!bases.some((baseConfig) => baseConfig.faction !== 'hostile' && (baseConfig.role ?? 'main') === 'main')) {
    throw new Error(`[coopDefenseMaps] Map ${mapId} needs at least one friendly main base to lose`);
  }
  return normalizedObjective;
}

function normalizeEncounterConfigs(
  mapId: string,
  encounters: readonly CoopDefenseMapEncounterConfig[] | undefined,
  context: EncounterTriggerNormalizationContext,
): readonly CoopDefenseMapEncounterConfig[] | undefined {
  if (encounters === undefined) return undefined;

  const uniqueEncounterIds = new Set<string>();
  return encounters.map((encounter, encounterIndex) => {
    if (typeof encounter.id !== 'string' || encounter.id.trim().length === 0) {
      throw new Error(`[coopDefenseMaps] Encounter on map ${mapId} needs a non-empty id`);
    }
    const id = encounter.id.trim();
    if (uniqueEncounterIds.has(id)) {
      throw new Error(`[coopDefenseMaps] Duplicate encounter id on map ${mapId}: ${id}`);
    }
    uniqueEncounterIds.add(id);
    if (!Array.isArray(encounter.groups) || encounter.groups.length === 0) {
      throw new Error(`[coopDefenseMaps] Encounter ${mapId}:${id} needs at least one group`);
    }

    return {
      id,
      start: normalizeEncounterStart(mapId, id, encounter.start, encounterIndex, context),
      restAfterMs: normalizeNonNegativeMilliseconds(encounter.restAfterMs),
      groups: encounter.groups.map((group) => normalizeEncounterGroup(mapId, id, group)),
    };
  });
}

interface EncounterTriggerNormalizationContext {
  readonly bases: readonly CoopBaseConfig[];
  readonly airstrikes: CoopDefenseMapAirstrikeConfig | undefined;
  readonly boss: CoopDefenseMapBossConfig | undefined;
}

function normalizeEncounterStart(
  mapId: string,
  encounterId: string,
  start: CoopDefenseMapEncounterStart | undefined,
  encounterIndex: number,
  context: EncounterTriggerNormalizationContext,
): CoopDefenseMapEncounterStart {
  if (!start || typeof start.type !== 'string') {
    throw new Error(`[coopDefenseMaps] Encounter ${mapId}:${encounterId} needs a start trigger`);
  }

  switch (start.type) {
    case 'time':
      return {
        type: 'time',
        atMs: normalizeRequiredMilliseconds(mapId, encounterId, start.atMs, 'time trigger'),
      };
    case 'after-previous':
      if (encounterIndex === 0) {
        throw new Error(`[coopDefenseMaps] Encounter ${mapId}:${encounterId} has no previous encounter`);
      }
      return { type: 'after-previous' };
    case 'opening-airstrike-complete':
      if (!context.airstrikes?.bombTutorialRock) {
        throw new Error(
          `[coopDefenseMaps] Encounter ${mapId}:${encounterId} needs an opening airstrike barrage`,
        );
      }
      return { type: 'opening-airstrike-complete' };
    case 'boss-phase':
      if (!Number.isFinite(start.phase) || !Number.isInteger(start.phase) || start.phase !== 2) {
        throw new Error(`[coopDefenseMaps] Encounter ${mapId}:${encounterId} supports boss phase 2 only`);
      }
      if (!context.boss || context.boss.enemyKind !== 'void-hunter') {
        throw new Error(
          `[coopDefenseMaps] Encounter ${mapId}:${encounterId} needs a Void Hunter boss for phase 2`,
        );
      }
      return { type: 'boss-phase', phase: 2 };
    case 'base-destroyed': {
      if (typeof start.baseId !== 'string' || start.baseId.trim().length === 0) {
        throw new Error(`[coopDefenseMaps] Encounter ${mapId}:${encounterId} needs a base id`);
      }
      const baseId = start.baseId.trim();
      if (!context.bases.some((base) => base.id === baseId)) {
        throw new Error(`[coopDefenseMaps] Encounter ${mapId}:${encounterId} references unknown base: ${baseId}`);
      }
      return { type: 'base-destroyed', baseId };
    }
    default:
      throw new Error(`[coopDefenseMaps] Encounter ${mapId}:${encounterId} has unknown start trigger`);
  }
}

function normalizeRequiredMilliseconds(
  mapId: string,
  encounterId: string,
  value: number,
  label: string,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`[coopDefenseMaps] Encounter ${mapId}:${encounterId} has invalid ${label} time`);
  }
  return Math.max(0, Math.floor(value));
}

function normalizeEncounterGroup(
  mapId: string,
  encounterId: string,
  group: CoopDefenseMapEncounterGroupConfig,
): CoopDefenseMapEncounterGroupConfig {
  if (!hasCoopDefenseEnemyKind(group.enemyKind)) {
    throw new Error(
      `[coopDefenseMaps] Encounter ${mapId}:${encounterId} references unknown enemy kind: ${group.enemyKind}`,
    );
  }
  if (getCoopDefenseEnemyConfig(group.enemyKind).isBoss) {
    throw new Error(
      `[coopDefenseMaps] Boss enemies must use the unique boss slot on map ${mapId}`,
    );
  }
  if (
    typeof group.count !== 'number'
    || !Number.isFinite(group.count)
    || Math.floor(group.count) < 1
  ) {
    throw new Error(
      `[coopDefenseMaps] Encounter ${mapId}:${encounterId} needs positive finite group counts`,
    );
  }

  return {
    enemyKind: group.enemyKind,
    count: Math.floor(group.count),
    delayMs: normalizeNonNegativeMilliseconds(group.delayMs),
    front: normalizeSpawnFront(mapId, encounterId, group.front),
  };
}

function normalizeSpawnFront(mapId: string, ownerId: string, value: SpawnFront | undefined): SpawnFront {
  if (value === undefined) return DEFAULT_SPAWN_FRONT;
  if (!isSpawnFront(value)) {
    throw new Error(`[coopDefenseMaps] ${mapId}:${ownerId} has unknown spawn front: ${value}`);
  }
  return value;
}

function normalizeNonNegativeMilliseconds(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
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

/**
 * Prüft das Zug-Event der Map. Ein Zug ohne Gleise wäre kein Balancing-Detail, sondern eine
 * Lok, die über blanken Boden fährt – deshalb ein Konfigurationsfehler statt stiller Rückfall.
 */
function normalizeTrainConfig(
  mapId: string,
  train: CoopDefenseMapTrainConfig | undefined,
  trackMode: CoopDefenseMapTrackMode,
): CoopDefenseMapTrainConfig | undefined {
  if (!train) return undefined;
  if (trackMode !== 'rails') {
    throw new Error(`[coopDefenseMaps] Map ${mapId} declares a train but no rails (trackMode: ${trackMode})`);
  }

  const firstArrival = train.firstArrival;
  if (!firstArrival || firstArrival.type !== 'time') {
    throw new Error(`[coopDefenseMaps] Train on map ${mapId} needs a supported first-arrival trigger`);
  }
  if (typeof firstArrival.atMs !== 'number' || !Number.isFinite(firstArrival.atMs)) {
    throw new Error(`[coopDefenseMaps] Train on map ${mapId} has an invalid first-arrival time`);
  }
  const repeatAfterExitMs = train.repeatAfterExitMs;
  if (repeatAfterExitMs !== undefined
    && (typeof repeatAfterExitMs !== 'number' || !Number.isFinite(repeatAfterExitMs) || repeatAfterExitMs < 0)) {
    throw new Error(`[coopDefenseMaps] Train on map ${mapId} has an invalid repeatAfterExitMs`);
  }

  return {
    firstArrival: { type: 'time', atMs: Math.max(0, Math.floor(firstArrival.atMs)) },
    repeatAfterExitMs: repeatAfterExitMs === undefined ? undefined : Math.max(0, Math.floor(repeatAfterExitMs)),
  };
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
  const bossPersistentSpawns = (mapConfig.persistentSpawns ?? [])
    .filter((spawn) => getCoopDefenseEnemyConfig(spawn.enemyKind).isBoss);
  if (bossPersistentSpawns.length > 0) {
    throw new Error(`[coopDefenseMaps] Boss enemies must use the unique boss slot on map ${mapConfig.mapId}`);
  }
  if (!mapConfig.boss) return undefined;

  if (!Number.isFinite(mapConfig.boss.spawnAtMs) || mapConfig.boss.spawnAtMs < 0) {
    throw new Error(`[coopDefenseMaps] Boss slot on map ${mapConfig.mapId} needs a non-negative spawnAtMs`);
  }

  const enemyConfig = getCoopDefenseEnemyConfig(mapConfig.boss.enemyKind);
  if (!enemyConfig.isBoss) {
    throw new Error(
      `[coopDefenseMaps] Boss slot on map ${mapConfig.mapId} references non-boss enemy ${mapConfig.boss.enemyKind}`,
    );
  }

  return {
    enemyKind: mapConfig.boss.enemyKind,
    spawnAtMs: Math.floor(mapConfig.boss.spawnAtMs),
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

  if (role === 'spawn-point' && !spawnCenter) {
    throw new Error(`[coopDefenseMaps] Spawn point ${baseConfig.id} needs spawnCenter`);
  }
  if (role !== 'spawn-point' && spawnCenter) {
    throw new Error(`[coopDefenseMaps] Only spawn points may declare spawnCenter: ${baseConfig.id}`);
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

function normalizePersistentSpawnConfigs(
  mapId: string,
  persistentSpawns: readonly CoopDefenseMapPersistentSpawnConfig[],
  bases: readonly CoopBaseConfig[],
): readonly CoopDefenseMapPersistentSpawnConfig[] {
  const uniqueIds = new Set<string>();
  return persistentSpawns.map((spawnConfig) => {
    if (typeof spawnConfig.id !== 'string' || spawnConfig.id.trim().length === 0) {
      throw new Error(`[coopDefenseMaps] Persistent spawn on map ${mapId} needs a non-empty id`);
    }
    const id = spawnConfig.id.trim();
    if (uniqueIds.has(id)) {
      throw new Error(`[coopDefenseMaps] Duplicate persistent spawn id on map ${mapId}: ${id}`);
    }
    uniqueIds.add(id);
    if (!hasCoopDefenseEnemyKind(spawnConfig.enemyKind)) {
      throw new Error(
        `[coopDefenseMaps] Persistent spawn ${mapId}:${id} references unknown enemy kind: ${spawnConfig.enemyKind}`,
      );
    }
    if (!Number.isFinite(spawnConfig.intervalMs) || spawnConfig.intervalMs <= 0) {
      throw new Error(`[coopDefenseMaps] Persistent spawn ${mapId}:${id} needs a positive interval`);
    }
    if (!Number.isFinite(spawnConfig.countPerTick) || spawnConfig.countPerTick < 1) {
      throw new Error(`[coopDefenseMaps] Persistent spawn ${mapId}:${id} needs a positive countPerTick`);
    }

    const source = normalizePersistentSpawnSource(mapId, id, spawnConfig.source, bases);
    if (source.type === 'base' && spawnConfig.front !== undefined) {
      throw new Error(`[coopDefenseMaps] Persistent spawn ${mapId}:${id} is structure-bound and cannot declare a front`);
    }
    return {
      id,
      enemyKind: spawnConfig.enemyKind,
      intervalMs: Math.max(1, Math.floor(spawnConfig.intervalMs)),
      countPerTick: Math.max(1, Math.floor(spawnConfig.countPerTick)),
      startAtMs: Math.max(0, Math.floor(spawnConfig.startAtMs ?? 0)),
      source,
      ...(source.type === 'map'
        ? { front: normalizeSpawnFront(mapId, id, spawnConfig.front) }
        : {}),
    };
  });
}

function normalizePersistentSpawnSource(
  mapId: string,
  spawnId: string,
  source: CoopDefenseMapPersistentSpawnSource,
  bases: readonly CoopBaseConfig[],
): CoopDefenseMapPersistentSpawnSource {
  if (source?.type === 'map') return { type: 'map' };
  if (source?.type !== 'base' || typeof source.baseId !== 'string' || source.baseId.trim().length === 0) {
    throw new Error(`[coopDefenseMaps] Persistent spawn ${mapId}:${spawnId} needs a map or base source`);
  }
  const baseId = source.baseId.trim();
  const base = bases.find((candidate) => candidate.id === baseId);
  if (!base) {
    throw new Error(`[coopDefenseMaps] Persistent spawn ${mapId}:${spawnId} references unknown base: ${baseId}`);
  }
  if ((base.role ?? 'main') !== 'spawn-point' || !base.spawnCenter) {
    throw new Error(`[coopDefenseMaps] Persistent spawn ${mapId}:${spawnId} needs a spawn-point base: ${baseId}`);
  }
  return { type: 'base', baseId };
}
