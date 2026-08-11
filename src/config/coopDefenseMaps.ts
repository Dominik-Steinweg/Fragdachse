import { COOP_DEFENSE_MAP_REGISTRY } from './coopDefenseMaps/index';
import {
  getCoopDefenseEnemyConfig,
  hasCoopDefenseEnemyKind,
  resolveCoopDefenseEnemySpawnConfig,
  type CoopDefenseEnemyKind,
} from './coopDefenseEnemies';
import { POWERUP_DEFS, shouldDelayFirstPedestalSpawn, TIMED_POWERUP_PEDESTAL_CONFIGS } from '../powerups/PowerUpConfig';
import {
  DEFAULT_COOP_DEFENSE_ARENA_HEIGHT_CELLS,
  DEFAULT_COOP_DEFENSE_ARENA_WIDTH_CELLS,
  ARENA_OFFSET_X,
  ARENA_OFFSET_Y,
  CELL_SIZE,
  normalizeCoopDefenseArenaHeightCells,
  normalizeCoopDefenseArenaWidthCells,
  ROCK_FILL_RATIO,
} from '../config';
import { DEFAULT_TIME_OF_DAY_MINUTES, formatTimeOfDay, parseTimeOfDay } from '../effects/TimeOfDay';
import { normalizeCoopDefensePlayerScalingFactor } from './coopDefenseScaling';
import type { GroundFireVisualStyle, SpawnFront } from '../types';
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

/** Standardfenster, in dem die Gegner einer Encounter-Gruppe einzeln eintreffen. */
export const DEFAULT_COOP_DEFENSE_ENCOUNTER_SPAWN_STAGGER_MS = 1_500;

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
  | 'TURRET_ROCKET_BURST'
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
  /**
   * Beschaedigter Startzustand als Anteil von `hpMax` (0 < f <= 1). Gedacht fuer Missionsziele, die
   * bewusst angeschlagen auftauchen. Beide Peers loesen ihn deterministisch aus der Map auf; nur die
   * spaetere HP-Aenderung laeuft ueber den replizierten Basis-Delta-Snapshot.
   */
  readonly startHpFactor?: number;
  /** Optionaler HP-Faktor; feindliche Strukturen verwenden sonst den zentralen Standard. */
  readonly playerScaling?: CoopBasePlayerScaling;
  readonly faction?: CoopBaseFaction;
  readonly role?: CoopBaseRole;
  /** Mission structure: constructed at round setup but inert until its objective leaves dormant. */
  readonly dormant?: boolean;
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
  /** Maximales Zeitfenster fuer zufaellig versetzte Einzelspawns; Standard 1,5 Sekunden. */
  readonly spawnStaggerMs?: number;
  readonly front?: SpawnFront;
}

/** Kleine, bewusst typisierte Startbedingungen fuer einen endlichen Encounter. */
export type CoopDefenseMapEncounterStart =
  | { readonly type: 'time'; readonly atMs: number }
  | { readonly type: 'after-previous' }
  | { readonly type: 'after-encounter'; readonly encounterId: string }
  | { readonly type: 'after-event'; readonly eventId: string }
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
  /** Effektives Einzelspawn-Fenster; fehlt nur bei Legacy-Aufrufern ausserhalb der Map-Aufloesung. */
  readonly spawnStaggerMs?: number;
  readonly front?: SpawnFront;
}

export interface ResolvedCoopDefenseMapEncounterConfig {
  readonly id: string;
  readonly start: CoopDefenseMapEncounterStart;
  readonly restAfterMs: number;
  readonly groups: readonly ResolvedCoopDefenseMapEncounterGroupConfig[];
}

export type CoopDefenseSecondaryObjectiveType = 'destroy' | 'hold' | 'carry';

/** Authored rectangle for a world-space Carry objective zone. Coordinates are arena cells. */
export interface CoopDefenseMapObjectiveZoneConfig {
  readonly gridX: number;
  readonly gridY: number;
  readonly widthCells: number;
  readonly heightCells: number;
}

export interface CoopDefenseMapObjectiveZoneWorldRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export function getCoopDefenseMapObjectiveZoneWorldRect(
  zone: CoopDefenseMapObjectiveZoneConfig,
): CoopDefenseMapObjectiveZoneWorldRect {
  return {
    x: ARENA_OFFSET_X + zone.gridX * CELL_SIZE,
    y: ARENA_OFFSET_Y + zone.gridY * CELL_SIZE,
    width: zone.widthCells * CELL_SIZE,
    height: zone.heightCells * CELL_SIZE,
  };
}

/** Carry-specific data; unlike Destroy/Hold it contains no dormant base references. */
export interface CoopDefenseMapCarryConfig {
  readonly spawnZone: CoopDefenseMapObjectiveZoneConfig;
  readonly deliveryZone: CoopDefenseMapObjectiveZoneConfig;
  /** Number of independently transportable bottles spawned when the objective activates. */
  readonly itemCount?: number;
}

/** Authored immediate team reward; resolved values keep B11 balancing data-driven. */
export interface CoopDefenseMapTeamBuffRewardConfig {
  readonly defId: string;
  readonly durationMs?: number;
  readonly hpRegenPerSecond?: number;
  readonly adrenalineRegenMultiplier?: number;
}

export const COOP_DEFENSE_TEAM_BUFF_DEFAULTS = {
  defId: 'TEAM_REGENERATION_SURGE',
  durationMs: 30_000,
  hpRegenPerSecond: 10,
  adrenalineRegenMultiplier: 1.5,
} as const;

export interface CoopDefenseMapSecondaryObjectiveRewards {
  /** Team-XP je aufgeloestem Ziel; gebucht beim Ziel, nicht beim Missionsabschluss. */
  readonly xpPerTarget?: number;
  /** Nur fuer `carry`: jede abgelieferte Flasche erhoeht die Epic-Option-Garantie. */
  readonly itemMetaRewardOnComplete?: boolean;
  /** Nur fuer Carry: unmittelbarer, teamweiter Buff bei vollstaendigem Abschluss. */
  readonly teamBuffOnComplete?: CoopDefenseMapTeamBuffRewardConfig;
  /**
   * Nur fuer `hold`: Missionsdrohnen stellen das ueberlebende Ziel wieder her. Ohne Angabe ist der
   * Wert fuer `hold` `true` – eine vergessene Zeile soll den Reward nicht still verschlucken. Ein
   * Hold mit anderem Reward (Podest) setzt ihn ausdruecklich auf `false`.
   */
  readonly repairTargetOnComplete?: boolean;
  /** Nur fuer `hold`: ein einmaliger Reward, der ein Power-Up-Podest platzierbar macht. */
  readonly placeablePedestalOnComplete?: {
    readonly powerUpDefId: string;
  };
}

export interface CoopDefenseMapSecondaryObjectiveConfig {
  readonly id: string;
  readonly type: CoopDefenseSecondaryObjectiveType;
  readonly start: CoopDefenseMapEncounterStart;
  readonly focusUntil?: CoopDefenseMapEncounterStart;
  /**
   * Nur fuer `hold` und dort Pflicht: Zeitpunkt, bis zu dem das Ziel leben muss. Hold besitzt keinen
   * Hintergrundzustand – dieses Fenster ist zugleich sein Fokusfenster.
   */
  readonly holdUntil?: CoopDefenseMapEncounterStart;
  /** Base targets for Destroy/Hold. Carry uses its authored `carry` zones instead. */
  readonly targets: readonly string[];
  readonly targetGoal?: number;
  readonly carry?: CoopDefenseMapCarryConfig;
  readonly rewards?: CoopDefenseMapSecondaryObjectiveRewards;
  /**
   * Missionsname im HUD, z. B. `BRUTNESTER ZERSTÖREN`. Rein darstellend und deshalb bewusst
   * authored statt repliziert: Der Client kennt die Map-Konfiguration ohnehin. Ohne Angabe
   * greift ein archetypischer Ersatzname.
   */
  readonly displayName?: string;
  /** Einzeilige Reward-Vorschau im HUD. Ohne Angabe greift ein archetypischer Hinweis. */
  readonly rewardHint?: string;
}

export interface ResolvedCoopDefenseMapSecondaryObjectiveConfig {
  readonly id: string;
  readonly type: CoopDefenseSecondaryObjectiveType;
  readonly start: CoopDefenseMapEncounterStart;
  readonly focusUntil?: CoopDefenseMapEncounterStart;
  readonly holdUntil?: CoopDefenseMapEncounterStart;
  readonly targets: readonly string[];
  readonly targetGoal: number;
  readonly carry?: CoopDefenseMapCarryConfig;
  readonly rewards?: CoopDefenseMapSecondaryObjectiveRewards;
  readonly displayName?: string;
  readonly rewardHint?: string;
}

// Kurze Aliasnamen halten den Vertrag für Systeme/Tests lesbar, ohne die Map-Config-Namensfamilie
// der bestehenden Encounter- und Spawndefinitionen aufzubrechen.
export type CoopDefenseSecondaryObjectiveConfig = CoopDefenseMapSecondaryObjectiveConfig;
export type ResolvedCoopDefenseSecondaryObjectiveConfig = ResolvedCoopDefenseMapSecondaryObjectiveConfig;

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
/** Kleine Triggerunion fuer alle C-Events. */
export type CoopDefenseMapEventStart =
  | { readonly type: 'time'; readonly atMs: number }
  | { readonly type: 'after-encounter'; readonly encounterId: string }
  | { readonly type: 'boss-phase'; readonly phase: number }
  | { readonly type: 'base-destroyed'; readonly baseId: string };

/** Gemeinsame Felder aller authored Map-Events. */
export interface CoopDefenseMapEventBase {
  readonly id: string;
  readonly start: CoopDefenseMapEventStart;
  /** Warnzeit zwischen erfülltem Trigger und Wirkung. */
  readonly delayMs?: number;
}

/** C1-Eventkonfiguration fuer den bestehenden Zug-Fachhandler. */
export interface CoopDefenseMapTrainEventConfig extends CoopDefenseMapEventBase {
  readonly type: 'train';
  /** Pause zwischen tatsächlichem Verlassen der Arena und nächster Einfahrt. */
  readonly repeatAfterExitMs?: number;
}

export type CoopDefenseMapAirstrikePattern = 'tutorial-sweep' | 'player-hunt' | 'zone-barrage';

/** Feste Grid-Zone fuer einen authored Luftangriff. */
export interface CoopDefenseMapAirstrikeArea {
  readonly gridX: number;
  readonly gridY: number;
  readonly widthCells: number;
  readonly heightCells: number;
}

/** C2-Airstrike-Event; die drei Muster besitzen bewusst nur feste, kleine Parameter. */
export interface CoopDefenseMapAirstrikeEventConfig extends CoopDefenseMapEventBase {
  readonly type: 'airstrike';
  readonly pattern: CoopDefenseMapAirstrikePattern;
  /** Abstand zwischen abgeschlossenen Player-Hunt-Zyklen. Nur fuer `player-hunt`. */
  readonly intervalMs?: number;
  /** Einschlagsanzahl fuer `tutorial-sweep` bzw. `zone-barrage`. */
  readonly strikeCount?: number;
  /** Authored Zielzone fuer `zone-barrage`. */
  readonly area?: CoopDefenseMapAirstrikeArea;
  /** Geordnete Streuung innerhalb der Zone. Nur fuer `zone-barrage`. */
  readonly orderedSweep?: boolean;
}

export type ResolvedCoopDefenseMapAirstrikeEventConfig = CoopDefenseMapAirstrikeEventConfig;

export type CoopDefenseMapGroundHazardArea =
  | {
    readonly type: 'random-patches';
    readonly randomPatchCount: number;
    readonly minPatchRadiusCells: number;
    readonly maxPatchRadiusCells: number;
    readonly baseClearanceCells?: number;
  }
  | {
    readonly type: 'rectangle';
    readonly gridX: number;
    readonly gridY: number;
    readonly widthCells: number;
    readonly heightCells: number;
    readonly baseClearanceCells?: number;
  }
  | {
    readonly type: 'cells';
    readonly cells: readonly { readonly gridX: number; readonly gridY: number }[];
    readonly baseClearanceCells?: number;
  };

export interface CoopDefenseMapGroundHazardEffectConfig {
  readonly visualStyle: GroundFireVisualStyle;
  readonly burnDurationMs: number;
  readonly burnDamagePerTick: number;
  readonly weaponName: string;
}

export interface CoopDefenseMapGroundHazardEventConfig extends CoopDefenseMapEventBase {
  readonly type: 'ground-hazard';
  readonly durationMs?: number;
  readonly area: CoopDefenseMapGroundHazardArea;
  readonly effect: CoopDefenseMapGroundHazardEffectConfig;
}

export type ResolvedCoopDefenseMapGroundHazardEventConfig = CoopDefenseMapGroundHazardEventConfig;

export type CoopDefenseMapEventConfig =
  | CoopDefenseMapTrainEventConfig
  | CoopDefenseMapAirstrikeEventConfig
  | CoopDefenseMapGroundHazardEventConfig;
/** Nach der Normalisierung sind Werte runtime-seitig bereinigt; die Union bleibt authoring-kompatibel. */
export type ResolvedCoopDefenseMapEventConfig = CoopDefenseMapEventConfig;

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
  /** Authored Map-Events; Gleise ohne Zug-Event bleiben erlaubt. */
  readonly mapEvents?: readonly CoopDefenseMapEventConfig[];
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
  /** Optionale, host-autoritativ aktivierte Nebenmissionen ohne Einfluss auf den Mapsieg. */
  readonly secondaryObjectives?: readonly CoopDefenseMapSecondaryObjectiveConfig[];
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
        spawnStaggerMs: group.spawnStaggerMs ?? DEFAULT_COOP_DEFENSE_ENCOUNTER_SPAWN_STAGGER_MS,
        front: group.front ?? DEFAULT_SPAWN_FRONT,
      };
    }),
  }));
}

export function resolveCoopDefenseMapSecondaryObjectives(
  mapConfig: CoopDefenseMapConfig,
  _humanPlayerCount?: number,
): readonly ResolvedCoopDefenseMapSecondaryObjectiveConfig[] {
  return (mapConfig.secondaryObjectives ?? []).map((objective) => ({
    id: objective.id,
    type: objective.type,
    start: objective.start,
    ...(objective.focusUntil ? { focusUntil: objective.focusUntil } : {}),
    ...(objective.holdUntil ? { holdUntil: objective.holdUntil } : {}),
    targets: [...(objective.targets ?? [])],
    targetGoal: objective.targetGoal ?? (objective.type === 'carry' && objective.carry
      ? objective.carry.itemCount ?? 1
      : objective.targets.length),
    ...(objective.carry ? { carry: cloneCarryConfig(objective.carry) } : {}),
    ...(objective.rewards ? { rewards: { ...objective.rewards } } : {}),
    ...(objective.displayName ? { displayName: objective.displayName } : {}),
    ...(objective.rewardHint ? { rewardHint: objective.rewardHint } : {}),
  }));
}

function cloneCarryConfig(config: CoopDefenseMapCarryConfig): CoopDefenseMapCarryConfig {
  return {
    spawnZone: { ...config.spawnZone },
    deliveryZone: { ...config.deliveryZone },
    ...(config.itemCount === undefined ? {} : { itemCount: config.itemCount }),
  };
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
  const arenaWidthCells = normalizeCoopDefenseArenaWidthCells(
    mapConfig.arenaWidthCells ?? DEFAULT_COOP_DEFENSE_ARENA_WIDTH_CELLS,
  );
  const arenaHeightCells = normalizeCoopDefenseArenaHeightCells(
    mapConfig.arenaHeightCells ?? DEFAULT_COOP_DEFENSE_ARENA_HEIGHT_CELLS,
  );
  const encounters = normalizeEncounterConfigs(mapConfig.mapId, mapConfig.encounters, { bases, boss });
  const trackMode: CoopDefenseMapTrackMode = mapConfig.trackMode === 'void-fire' ? 'void-fire' : 'rails';
  const mapEvents = normalizeMapEvents(
    mapConfig.mapId,
    mapConfig.mapEvents,
    encounters ?? [],
    bases,
    boss,
    trackMode,
    arenaWidthCells,
    arenaHeightCells,
  );
  validateMapEventDependencyGraph(mapConfig.mapId, encounters ?? [], mapEvents);
  const itemDrop = normalizeItemDropConfig(mapConfig.mapId, mapConfig.itemDrop);
  const secondaryObjectives = normalizeSecondaryObjectiveConfigs(mapConfig.mapId, mapConfig.secondaryObjectives, {
    bases,
    encounters,
    objective,
    itemDrop,
    arenaWidthCells,
    arenaHeightCells,
  });
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
    rockFillRatio: normalizeRockFillRatio(mapConfig.rockFillRatio),
    rockField: normalizeRockFieldConfig(mapConfig.mapId, mapConfig.rockField),
    trackMode,
    mapEvents,
    timeOfDay: normalizeTimeOfDayValue(mapConfig.mapId, mapConfig.timeOfDay),
    tutorialRockArmorDropMult: normalizeTutorialRockArmorDropMult(mapConfig.tutorialRockArmorDropMult),
    surviveDurationSec,
    balanceReferenceDurationSec,
    bases,
    powerUps: mapConfig.powerUps.map((powerUpConfig) => normalizePowerUpConfig(mapConfig.mapId, powerUpConfig)),
    persistentSpawns: normalizePersistentSpawnConfigs(mapConfig.mapId, persistentSpawns, bases),
    encounters,
    secondaryObjectives,
    boss,
    objective,
    surviveRespawnsPerPlayer: normalizeSurviveRespawnsPerPlayer(
      mapConfig.mapId,
      objective,
      mapConfig.surviveRespawnsPerPlayer,
    ),
    itemDrop,
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
): readonly ResolvedCoopDefenseMapEncounterConfig[] | undefined {
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

interface SecondaryObjectiveNormalizationContext {
  readonly bases: readonly CoopBaseConfig[];
  readonly encounters: readonly CoopDefenseMapEncounterConfig[] | undefined;
  readonly objective: CoopDefenseMapObjective;
  readonly itemDrop: CoopDefenseMapItemDropConfig | undefined;
  readonly arenaWidthCells: number;
  readonly arenaHeightCells: number;
}

function normalizeSecondaryObjectiveConfigs(
  mapId: string,
  secondaryObjectives: readonly CoopDefenseMapSecondaryObjectiveConfig[] | undefined,
  context: SecondaryObjectiveNormalizationContext,
): readonly CoopDefenseMapSecondaryObjectiveConfig[] | undefined {
  if (secondaryObjectives === undefined) {
    validateDormantMissionStructures(mapId, context.bases, []);
    return undefined;
  }
  if (!Array.isArray(secondaryObjectives)) {
    throw new Error(`[coopDefenseMaps] Secondary objectives on map ${mapId} need an array`);
  }

  const uniqueObjectiveIds = new Set<string>();
  const normalizedObjectives = secondaryObjectives.map((objective) => {
    if (typeof objective.id !== 'string' || objective.id.trim().length === 0) {
      throw new Error(`[coopDefenseMaps] Secondary objective on map ${mapId} needs a non-empty id`);
    }
    const id = objective.id.trim();
    if (uniqueObjectiveIds.has(id)) {
      throw new Error(`[coopDefenseMaps] Duplicate secondary objective id on map ${mapId}: ${id}`);
    }
    uniqueObjectiveIds.add(id);

    if (!isSecondaryObjectiveType(objective.type)) {
      throw new Error(`[coopDefenseMaps] Secondary objective ${mapId}:${id} has an unknown type: ${objective.type}`);
    }
    const authoredTargets = Array.isArray(objective.targets) ? objective.targets : [];
    const isCarry = objective.type === 'carry';
    if (!isCarry && authoredTargets.length === 0) {
      throw new Error(`[coopDefenseMaps] Secondary objective ${mapId}:${id} needs at least one target`);
    }
    if (isCarry && authoredTargets.length > 0 && objective.carry !== undefined) {
      throw new Error(
        `[coopDefenseMaps] Carry secondary objective ${mapId}:${id} must use carry zones, not base targets`,
      );
    }
    if (isCarry && authoredTargets.length === 0 && objective.carry === undefined) {
      throw new Error(`[coopDefenseMaps] Carry secondary objective ${mapId}:${id} needs carry zones`);
    }

    // Hold ist binaer und besitzt keinen Hintergrundzustand: genau ein Ziel, ein authored Haltefenster
    // statt eines Fokusfensters. Alle anderen Archetypen kennen kein holdUntil.
    if (objective.type === 'hold') {
      if (objective.holdUntil === undefined) {
        throw new Error(`[coopDefenseMaps] Hold secondary objective ${mapId}:${id} needs a holdUntil trigger`);
      }
      if (objective.focusUntil !== undefined) {
        throw new Error(`[coopDefenseMaps] Hold secondary objective ${mapId}:${id} must not declare focusUntil`);
      }
      if (authoredTargets.length !== 1) {
        throw new Error(`[coopDefenseMaps] Hold secondary objective ${mapId}:${id} needs exactly one target`);
      }
    } else if (objective.holdUntil !== undefined) {
      throw new Error(`[coopDefenseMaps] Secondary objective ${mapId}:${id} must not declare holdUntil`);
    }

    const targetIds = new Set<string>();
    const targets = authoredTargets.map((targetId: string) => {
      if (typeof targetId !== 'string' || targetId.trim().length === 0) {
        throw new Error(`[coopDefenseMaps] Secondary objective ${mapId}:${id} needs non-empty target ids`);
      }
      const normalizedTargetId = targetId.trim();
      if (targetIds.has(normalizedTargetId)) {
        throw new Error(
          `[coopDefenseMaps] Secondary objective ${mapId}:${id} has duplicate target id: ${normalizedTargetId}`,
        );
      }
      targetIds.add(normalizedTargetId);
      if (!context.bases.some((base) => base.id === normalizedTargetId)) {
        throw new Error(
          `[coopDefenseMaps] Secondary objective ${mapId}:${id} references unknown target base: ${normalizedTargetId}`,
        );
      }
      return normalizedTargetId;
    });

    const carry = isCarry && objective.carry
      ? normalizeCarryConfig(mapId, id, objective.carry, objective.targetGoal, context)
      : undefined;
    const targetGoal = isCarry && carry
      ? Math.floor(objective.targetGoal ?? carry?.itemCount ?? 1)
      : typeof objective.targetGoal === 'number' && Number.isFinite(objective.targetGoal)
        ? Math.max(1, Math.min(targets.length, Math.floor(objective.targetGoal)))
        : targets.length;

    return {
      id,
      type: objective.type,
      start: normalizeSecondaryObjectiveTrigger(mapId, id, objective.start, 'start', context),
      ...(objective.focusUntil === undefined
        ? {}
        : { focusUntil: normalizeSecondaryObjectiveTrigger(mapId, id, objective.focusUntil, 'focusUntil', context) }),
      ...(objective.holdUntil === undefined
        ? {}
        : { holdUntil: normalizeSecondaryObjectiveTrigger(mapId, id, objective.holdUntil, 'holdUntil', context) }),
      targets,
      targetGoal,
      ...(carry ? { carry } : {}),
      ...(objective.rewards === undefined && objective.type !== 'hold'
        ? {}
        : {
          rewards: normalizeSecondaryObjectiveRewards(
            mapId,
            id,
            objective.type,
            objective.rewards ?? {},
            context.itemDrop !== undefined,
          ),
        }),
      ...normalizeSecondaryObjectiveLabel(mapId, id, 'displayName', objective.displayName),
      ...normalizeSecondaryObjectiveLabel(mapId, id, 'rewardHint', objective.rewardHint),
    };
  });

  validateDormantMissionStructures(
    mapId,
    context.bases,
    normalizedObjectives.filter((objective) => objective.type !== 'carry' || objective.carry === undefined),
  );
  validateSecondaryObjectiveWindows(mapId, normalizedObjectives, context.encounters);
  if (context.objective === 'repel-assault' && context.encounters && context.encounters.length > 0) {
    const lastEncounterId = context.encounters[context.encounters.length - 1].id;
    for (const objective of normalizedObjectives) {
      if (objective.type !== 'hold') continue;
      // Der Reward haengt an holdUntil: Ein Halten, das erst mit dem rundenbeendenden Clear faellig
      // waere, koennte nie ausgezahlt werden.
      const isBoundToLastEncounter = [objective.start, objective.holdUntil]
        .some((trigger) => trigger?.type === 'after-encounter' && trigger.encounterId === lastEncounterId);
      if (isBoundToLastEncounter) {
        throw new Error(
          `[coopDefenseMaps] Hold secondary objective ${mapId}:${objective.id} must not bind to the last repel-assault encounter: ${lastEncounterId}`,
        );
      }
    }
  }
  return normalizedObjectives;
}

function normalizeCarryConfig(
  mapId: string,
  objectiveId: string,
  carry: CoopDefenseMapCarryConfig | undefined,
  authoredTargetGoal: number | undefined,
  context: SecondaryObjectiveNormalizationContext,
): CoopDefenseMapCarryConfig {
  if (!carry) {
    throw new Error(`[coopDefenseMaps] Carry secondary objective ${mapId}:${objectiveId} needs carry zones`);
  }

  const spawnZone = normalizeCarryZone(mapId, objectiveId, 'spawnZone', carry.spawnZone, context);
  const deliveryZone = normalizeCarryZone(mapId, objectiveId, 'deliveryZone', carry.deliveryZone, context);
  if (zonesOverlap(spawnZone, deliveryZone)) {
    throw new Error(`[coopDefenseMaps] Carry secondary objective ${mapId}:${objectiveId} zones must not overlap`);
  }

  const authoredItemCount = carry.itemCount ?? authoredTargetGoal ?? 1;
  if (!Number.isInteger(authoredItemCount) || authoredItemCount < 1) {
    throw new Error(`[coopDefenseMaps] Carry secondary objective ${mapId}:${objectiveId} needs a positive itemCount`);
  }
  if (authoredTargetGoal !== undefined && (!Number.isInteger(authoredTargetGoal) || authoredTargetGoal < 1)) {
    throw new Error(`[coopDefenseMaps] Carry secondary objective ${mapId}:${objectiveId} needs a positive targetGoal`);
  }
  if (authoredTargetGoal !== undefined && authoredTargetGoal > authoredItemCount) {
    throw new Error(
      `[coopDefenseMaps] Carry secondary objective ${mapId}:${objectiveId} targetGoal cannot exceed itemCount`,
    );
  }

  return {
    spawnZone,
    deliveryZone,
    itemCount: authoredItemCount,
  };
}

function normalizeCarryZone(
  mapId: string,
  objectiveId: string,
  zoneName: 'spawnZone' | 'deliveryZone',
  zone: CoopDefenseMapObjectiveZoneConfig | undefined,
  context: SecondaryObjectiveNormalizationContext,
): CoopDefenseMapObjectiveZoneConfig {
  if (!zone || typeof zone !== 'object') {
    throw new Error(`[coopDefenseMaps] Carry secondary objective ${mapId}:${objectiveId} needs ${zoneName}`);
  }
  const values = [zone.gridX, zone.gridY, zone.widthCells, zone.heightCells];
  if (values.some((value) => !Number.isInteger(value))) {
    throw new Error(`[coopDefenseMaps] Carry secondary objective ${mapId}:${objectiveId} has invalid ${zoneName}`);
  }
  if (zone.gridX < 0 || zone.gridY < 0 || zone.widthCells < 1 || zone.heightCells < 1
    || zone.gridX + zone.widthCells > context.arenaWidthCells
    || zone.gridY + zone.heightCells > context.arenaHeightCells) {
    throw new Error(`[coopDefenseMaps] Carry secondary objective ${mapId}:${objectiveId} has out-of-bounds ${zoneName}`);
  }
  return {
    gridX: zone.gridX,
    gridY: zone.gridY,
    widthCells: zone.widthCells,
    heightCells: zone.heightCells,
  };
}

function zonesOverlap(
  first: CoopDefenseMapObjectiveZoneConfig,
  second: CoopDefenseMapObjectiveZoneConfig,
): boolean {
  return first.gridX < second.gridX + second.widthCells
    && first.gridX + first.widthCells > second.gridX
    && first.gridY < second.gridY + second.heightCells
    && first.gridY + first.heightCells > second.gridY;
}

/**
 * Secondary-objective targets are the authored mission structures for B2. Keeping this
 * relationship explicit in the map data lets both peers derive dormancy from the same map
 * without adding another network field.
 */
function validateDormantMissionStructures(
  mapId: string,
  bases: readonly CoopBaseConfig[],
  objectives: readonly CoopDefenseMapSecondaryObjectiveConfig[],
): void {
  const dormantBaseIds = new Set(
    bases.filter((base) => base.dormant === true).map((base) => base.id),
  );
  const objectiveReferences = new Map<string, string[]>();

  for (const objective of objectives) {
    for (const targetId of objective.targets) {
      if (!dormantBaseIds.has(targetId)) {
        throw new Error(
          `[coopDefenseMaps] Secondary objective ${mapId}:${objective.id} target ${targetId} must be marked dormant`,
        );
      }
      const references = objectiveReferences.get(targetId) ?? [];
      references.push(objective.id);
      objectiveReferences.set(targetId, references);
    }
  }

  for (const base of bases) {
    if (base.dormant !== true) continue;
    const references = objectiveReferences.get(base.id) ?? [];
    if (references.length !== 1) {
      throw new Error(
        `[coopDefenseMaps] Dormant mission structure ${mapId}:${base.id} must be referenced by exactly one secondary objective`,
      );
    }
  }
}

function isSecondaryObjectiveType(value: unknown): value is CoopDefenseSecondaryObjectiveType {
  return value === 'destroy' || value === 'hold' || value === 'carry';
}

function normalizeSecondaryObjectiveTrigger(
  mapId: string,
  objectiveId: string,
  trigger: CoopDefenseMapEncounterStart | undefined,
  fieldName: 'start' | 'focusUntil' | 'holdUntil',
  context: SecondaryObjectiveNormalizationContext,
): CoopDefenseMapEncounterStart {
  if (!trigger || typeof trigger.type !== 'string') {
    throw new Error(`[coopDefenseMaps] Secondary objective ${mapId}:${objectiveId} needs a valid ${fieldName} trigger`);
  }
  switch (trigger.type) {
    case 'time':
      if (typeof trigger.atMs !== 'number' || !Number.isFinite(trigger.atMs)) {
        throw new Error(
          `[coopDefenseMaps] Secondary objective ${mapId}:${objectiveId} has invalid ${fieldName} time`,
        );
      }
      return { type: 'time', atMs: Math.max(0, Math.floor(trigger.atMs)) };
    case 'after-encounter': {
      if (typeof trigger.encounterId !== 'string' || trigger.encounterId.trim().length === 0) {
        throw new Error(
          `[coopDefenseMaps] Secondary objective ${mapId}:${objectiveId} needs an encounter id for ${fieldName}`,
        );
      }
      const encounterId = trigger.encounterId.trim();
      if (!context.encounters?.some((encounter) => encounter.id === encounterId)) {
        throw new Error(
          `[coopDefenseMaps] Secondary objective ${mapId}:${objectiveId} references unknown encounter: ${encounterId}`,
        );
      }
      return { type: 'after-encounter', encounterId };
    }
    default:
      throw new Error(
        `[coopDefenseMaps] Secondary objective ${mapId}:${objectiveId} has unsupported ${fieldName} trigger: ${trigger.type}`,
      );
  }
}

/**
 * Rein darstellende Beschriftung. Die Obergrenzen sind Layoutgrenzen des HUD-Panels, kein
 * Geschmacksurteil: Ein längerer Name würde dort abgeschnitten und wäre in der Ankündigung
 * nicht mehr auf einen Blick erfassbar.
 */
function normalizeSecondaryObjectiveLabel(
  mapId: string,
  objectiveId: string,
  fieldName: 'displayName' | 'rewardHint',
  value: string | undefined,
): Record<string, string> {
  if (value === undefined) return {};
  if (typeof value !== 'string') {
    throw new Error(`[coopDefenseMaps] Secondary objective ${mapId}:${objectiveId} has a non-string ${fieldName}`);
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error(`[coopDefenseMaps] Secondary objective ${mapId}:${objectiveId} has an empty ${fieldName}`);
  }
  const maxLength = fieldName === 'displayName' ? 34 : 48;
  if (trimmed.length > maxLength) {
    throw new Error(
      `[coopDefenseMaps] Secondary objective ${mapId}:${objectiveId} has a ${fieldName} longer than ${maxLength} characters`,
    );
  }
  return { [fieldName]: trimmed };
}

function normalizeSecondaryObjectiveRewards(
  mapId: string,
  objectiveId: string,
  objectiveType: CoopDefenseSecondaryObjectiveType,
  rewards: CoopDefenseMapSecondaryObjectiveRewards,
  hasItemDrop: boolean,
): CoopDefenseMapSecondaryObjectiveRewards {
  if (typeof rewards !== 'object' || rewards === null || Array.isArray(rewards)) {
    throw new Error(`[coopDefenseMaps] Secondary objective ${mapId}:${objectiveId} has invalid rewards`);
  }
  const hasRepairFlag = Object.prototype.hasOwnProperty.call(rewards, 'repairTargetOnComplete');
  if (hasRepairFlag && objectiveType !== 'hold') {
    throw new Error(
      `[coopDefenseMaps] Secondary objective ${mapId}:${objectiveId} must not declare repairTargetOnComplete`,
    );
  }
  if (hasRepairFlag && typeof rewards.repairTargetOnComplete !== 'boolean') {
    throw new Error(
      `[coopDefenseMaps] Secondary objective ${mapId}:${objectiveId} has a non-boolean repairTargetOnComplete`,
    );
  }
  const hasItemMetaReward = Object.prototype.hasOwnProperty.call(rewards, 'itemMetaRewardOnComplete');
  if (hasItemMetaReward && objectiveType !== 'carry') {
    throw new Error(
      `[coopDefenseMaps] Secondary objective ${mapId}:${objectiveId} must not declare itemMetaRewardOnComplete`,
    );
  }
  if (hasItemMetaReward && typeof rewards.itemMetaRewardOnComplete !== 'boolean') {
    throw new Error(
      `[coopDefenseMaps] Secondary objective ${mapId}:${objectiveId} has a non-boolean itemMetaRewardOnComplete`,
    );
  }
  if (rewards.itemMetaRewardOnComplete === true && !hasItemDrop) {
    throw new Error(
      `[coopDefenseMaps] Carry secondary objective ${mapId}:${objectiveId} with an item meta reward needs itemDrop`,
    );
  }
  const hasTeamBuffReward = Object.prototype.hasOwnProperty.call(rewards, 'teamBuffOnComplete');
  if (hasTeamBuffReward && objectiveType !== 'carry') {
    throw new Error(
      `[coopDefenseMaps] Secondary objective ${mapId}:${objectiveId} must not declare teamBuffOnComplete`,
    );
  }
  const teamBuffReward = hasTeamBuffReward
    ? normalizeTeamBuffReward(mapId, objectiveId, rewards.teamBuffOnComplete)
    : undefined;
  const hasPlaceablePedestalReward = Object.prototype.hasOwnProperty.call(rewards, 'placeablePedestalOnComplete');
  if (hasPlaceablePedestalReward && objectiveType !== 'hold') {
    throw new Error(
      `[coopDefenseMaps] Secondary objective ${mapId}:${objectiveId} must not declare placeablePedestalOnComplete`,
    );
  }
  const placeableReward = rewards.placeablePedestalOnComplete;
  if (hasPlaceablePedestalReward && (
    typeof placeableReward !== 'object'
    || placeableReward === null
    || Array.isArray(placeableReward)
    || typeof placeableReward.powerUpDefId !== 'string'
    || placeableReward.powerUpDefId.trim().length === 0
  )) {
    throw new Error(
      `[coopDefenseMaps] Secondary objective ${mapId}:${objectiveId} has an invalid placeablePedestalOnComplete`,
    );
  }
  const normalizedPowerUpDefId = hasPlaceablePedestalReward
    ? placeableReward?.powerUpDefId.trim()
    : undefined;
  if (normalizedPowerUpDefId !== undefined && (
    POWERUP_DEFS[normalizedPowerUpDefId] === undefined
    || TIMED_POWERUP_PEDESTAL_CONFIGS[normalizedPowerUpDefId] === undefined
  )) {
    throw new Error(
      `[coopDefenseMaps] Secondary objective ${mapId}:${objectiveId} references unknown timed Power-Up pedestal: ${normalizedPowerUpDefId}`,
    );
  }
  if (normalizedPowerUpDefId !== undefined && rewards.repairTargetOnComplete !== false) {
    throw new Error(
      `[coopDefenseMaps] Secondary objective ${mapId}:${objectiveId} must set repairTargetOnComplete=false when placing a pedestal reward`,
    );
  }
  // Die Wiederherstellung ist der Standardreward eines Holds; ein Hold mit anderem Reward schaltet
  // sie ausdruecklich ab, statt sie durch eine fehlende Zeile zu verlieren.
  const repair = objectiveType === 'hold'
    ? { repairTargetOnComplete: hasRepairFlag ? rewards.repairTargetOnComplete === true : true }
    : {};
  const placement = normalizedPowerUpDefId === undefined
    ? {}
    : { placeablePedestalOnComplete: { powerUpDefId: normalizedPowerUpDefId } };
  const itemMetaReward = hasItemMetaReward
    ? { itemMetaRewardOnComplete: rewards.itemMetaRewardOnComplete === true }
    : {};
  const teamBuff = teamBuffReward === undefined ? {} : { teamBuffOnComplete: teamBuffReward };
  if (!Object.prototype.hasOwnProperty.call(rewards, 'xpPerTarget')) {
    return { ...repair, ...itemMetaReward, ...teamBuff, ...placement };
  }
  const value = rewards.xpPerTarget;
  return {
    ...repair,
    ...itemMetaReward,
    ...teamBuff,
    ...placement,
    xpPerTarget: typeof value === 'number' && Number.isFinite(value)
      ? Math.max(0, Math.floor(value))
      : 0,
  };
}

function normalizeTeamBuffReward(
  mapId: string,
  objectiveId: string,
  reward: CoopDefenseMapTeamBuffRewardConfig | undefined,
): CoopDefenseMapTeamBuffRewardConfig {
  if (!reward || typeof reward !== 'object' || Array.isArray(reward)) {
    throw new Error(`[coopDefenseMaps] Carry secondary objective ${mapId}:${objectiveId} has invalid teamBuffOnComplete`);
  }
  if (typeof reward.defId !== 'string' || reward.defId.trim().length === 0) {
    throw new Error(`[coopDefenseMaps] Carry secondary objective ${mapId}:${objectiveId} needs a team buff defId`);
  }
  const durationMs = normalizeTeamBuffNumber(
    mapId,
    objectiveId,
    'durationMs',
    reward.durationMs,
    COOP_DEFENSE_TEAM_BUFF_DEFAULTS.durationMs,
    (value) => value > 0,
  );
  const hpRegenPerSecond = normalizeTeamBuffNumber(
    mapId,
    objectiveId,
    'hpRegenPerSecond',
    reward.hpRegenPerSecond,
    COOP_DEFENSE_TEAM_BUFF_DEFAULTS.hpRegenPerSecond,
    (value) => value >= 0,
  );
  const adrenalineRegenMultiplier = normalizeTeamBuffNumber(
    mapId,
    objectiveId,
    'adrenalineRegenMultiplier',
    reward.adrenalineRegenMultiplier,
    COOP_DEFENSE_TEAM_BUFF_DEFAULTS.adrenalineRegenMultiplier,
    (value) => value > 0,
  );
  return {
    defId: reward.defId.trim(),
    durationMs,
    hpRegenPerSecond,
    adrenalineRegenMultiplier,
  };
}

function normalizeTeamBuffNumber(
  mapId: string,
  objectiveId: string,
  fieldName: string,
  value: number | undefined,
  fallback: number,
  isValid: (value: number) => boolean,
): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value) || !isValid(value)) {
    throw new Error(
      `[coopDefenseMaps] Carry secondary objective ${mapId}:${objectiveId} has invalid team buff ${fieldName}`,
    );
  }
  return value;
}

interface AuthoredSecondaryObjectiveTimeWindow {
  readonly startAtMs: number;
  readonly endAtMs: number;
}

interface AuthoredSecondaryObjectiveEncounterWindow {
  /** Half-open range of encounter boundaries: [start, end). */
  readonly startEncounterIndex: number;
  readonly endEncounterIndex: number;
}

/**
 * Ende des authored Aktivfensters. Hold besitzt kein `focusUntil`; sein `holdUntil` beendet
 * Lebenszyklus und Fokus zugleich und ist damit dasselbe Fensterende.
 */
function getAuthoredSecondaryObjectiveWindowEnd(
  objective: CoopDefenseMapSecondaryObjectiveConfig,
): CoopDefenseMapEncounterStart | undefined {
  return objective.focusUntil ?? objective.holdUntil;
}

function getAuthoredSecondaryObjectiveTimeWindow(
  objective: CoopDefenseMapSecondaryObjectiveConfig,
): AuthoredSecondaryObjectiveTimeWindow | null {
  if (objective.start.type !== 'time') return null;
  const end = getAuthoredSecondaryObjectiveWindowEnd(objective);
  // Ein Encounter-Clear ist in authored Daten kein fester Zeitpunkt. Das Fenster darf deshalb
  // nicht fälschlich als unendlich lang behandelt und dadurch zu streng abgelehnt werden.
  if (end !== undefined && end.type !== 'time') return null;
  return {
    startAtMs: objective.start.atMs,
    endAtMs: end?.atMs ?? Number.POSITIVE_INFINITY,
  };
}

function getAuthoredSecondaryObjectiveEncounterWindow(
  objective: CoopDefenseMapSecondaryObjectiveConfig,
  encounterIndexById: ReadonlyMap<string, number>,
): AuthoredSecondaryObjectiveEncounterWindow | null {
  if (objective.start.type !== 'after-encounter') return null;
  const startEncounterIndex = encounterIndexById.get(objective.start.encounterId);
  if (startEncounterIndex === undefined) return null;

  const end = getAuthoredSecondaryObjectiveWindowEnd(objective);
  if (end === undefined) {
    return { startEncounterIndex, endEncounterIndex: Number.POSITIVE_INFINITY };
  }
  if (end.type !== 'after-encounter') return null;
  const endEncounterIndex = encounterIndexById.get(end.encounterId);
  if (endEncounterIndex === undefined) return null;
  if (endEncounterIndex <= startEncounterIndex) {
    const fieldName = objective.focusUntil ? 'focusUntil' : 'holdUntil';
    throw new Error(
      `[coopDefenseMaps] Secondary objective ${objective.id} has a ${fieldName} encounter before or equal to its start encounter`,
    );
  }
  return { startEncounterIndex, endEncounterIndex };
}

function validateSecondaryObjectiveWindows(
  mapId: string,
  objectives: readonly CoopDefenseMapSecondaryObjectiveConfig[],
  encounters: readonly CoopDefenseMapEncounterConfig[] | undefined,
): void {
  for (const objective of objectives) {
    const end = getAuthoredSecondaryObjectiveWindowEnd(objective);
    if (objective.start.type === 'time'
      && end?.type === 'time'
      && end.atMs <= objective.start.atMs) {
      const fieldName = objective.focusUntil ? 'focusUntil' : 'holdUntil';
      throw new Error(
        `[coopDefenseMaps] Secondary objective ${mapId}:${objective.id} has a ${fieldName} before its start`,
      );
    }
  }

  const encounterIndexById = new Map(
    (encounters ?? []).map((encounter, index) => [encounter.id, index]),
  );

  for (let firstIndex = 0; firstIndex < objectives.length; firstIndex += 1) {
    const firstTimeWindow = getAuthoredSecondaryObjectiveTimeWindow(objectives[firstIndex]);
    const firstEncounterWindow = getAuthoredSecondaryObjectiveEncounterWindow(
      objectives[firstIndex],
      encounterIndexById,
    );
    for (let secondIndex = firstIndex + 1; secondIndex < objectives.length; secondIndex += 1) {
      const firstStart = objectives[firstIndex].start;
      const secondStart = objectives[secondIndex].start;
      if (firstStart.type === 'after-encounter'
        && secondStart.type === 'after-encounter'
        && firstStart.encounterId === secondStart.encounterId) {
        throw new Error(
          `[coopDefenseMaps] Secondary objectives ${mapId}:${objectives[firstIndex].id} and ${objectives[secondIndex].id} have overlapping authored active windows from the same start encounter`,
        );
      }

      const secondTimeWindow = getAuthoredSecondaryObjectiveTimeWindow(objectives[secondIndex]);
      if (firstTimeWindow && secondTimeWindow) {
        const overlapStart = Math.max(firstTimeWindow.startAtMs, secondTimeWindow.startAtMs);
        const overlapEnd = Math.min(firstTimeWindow.endAtMs, secondTimeWindow.endAtMs);
        if (overlapStart < overlapEnd) {
          throw new Error(
            `[coopDefenseMaps] Secondary objectives ${mapId}:${objectives[firstIndex].id} and ${objectives[secondIndex].id} have overlapping authored active windows`,
          );
        }
      }

      const secondEncounterWindow = getAuthoredSecondaryObjectiveEncounterWindow(
        objectives[secondIndex],
        encounterIndexById,
      );
      if (!firstEncounterWindow || !secondEncounterWindow) continue;
      const encounterOverlapStart = Math.max(
        firstEncounterWindow.startEncounterIndex,
        secondEncounterWindow.startEncounterIndex,
      );
      const encounterOverlapEnd = Math.min(
        firstEncounterWindow.endEncounterIndex,
        secondEncounterWindow.endEncounterIndex,
      );
      if (encounterOverlapStart < encounterOverlapEnd) {
        throw new Error(
          `[coopDefenseMaps] Secondary objectives ${mapId}:${objectives[firstIndex].id} and ${objectives[secondIndex].id} have overlapping authored active windows`,
        );
      }
    }
  }
}

interface EncounterTriggerNormalizationContext {
  readonly bases: readonly CoopBaseConfig[];
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
    case 'after-encounter':
      if (typeof start.encounterId !== 'string' || start.encounterId.trim().length === 0) {
        throw new Error(`[coopDefenseMaps] Encounter ${mapId}:${encounterId} needs an encounter id`);
      }
      return { type: 'after-encounter', encounterId: start.encounterId.trim() };
    case 'after-event':
      if (typeof start.eventId !== 'string' || start.eventId.trim().length === 0) {
        throw new Error(`[coopDefenseMaps] Encounter ${mapId}:${encounterId} needs an event id`);
      }
      return { type: 'after-event', eventId: start.eventId.trim() };
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
): ResolvedCoopDefenseMapEncounterGroupConfig {
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
    spawnStaggerMs: normalizeNonNegativeMilliseconds(
      group.spawnStaggerMs ?? DEFAULT_COOP_DEFENSE_ENCOUNTER_SPAWN_STAGGER_MS,
    ),
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

/** Normalisiert die kleinen, festen C1/C2-Map-Event-Konfigurationen. */
function normalizeMapEvents(
  mapId: string,
  events: readonly CoopDefenseMapEventConfig[] | undefined,
  encounters: readonly ResolvedCoopDefenseMapEncounterConfig[],
  bases: readonly CoopBaseConfig[],
  boss: CoopDefenseMapBossConfig | undefined,
  trackMode: CoopDefenseMapTrackMode,
  arenaWidthCells: number,
  arenaHeightCells: number,
): readonly ResolvedCoopDefenseMapEventConfig[] {
  if (events === undefined) return [];
  if (!Array.isArray(events)) {
    throw new Error(`[coopDefenseMaps] Map ${mapId} has invalid mapEvents`);
  }

  const eventIds = new Set<string>();
  return events.map((event) => {
    if (!event || typeof event !== 'object' || Array.isArray(event)) {
      throw new Error(`[coopDefenseMaps] Map ${mapId} has an invalid map event`);
    }
    if (typeof event.id !== 'string' || event.id.trim().length === 0 || event.id.trim() !== event.id) {
      throw new Error(`[coopDefenseMaps] Map ${mapId} has a map event with an invalid id`);
    }
    if (eventIds.has(event.id)) {
      throw new Error(`[coopDefenseMaps] Duplicate map event id in map ${mapId}: ${event.id}`);
    }
    eventIds.add(event.id);
    const start = normalizeMapEventStart(mapId, event.id, event.start, encounters, { bases, boss });
    const delayMs = normalizeMapEventMilliseconds(mapId, event.id, event.delayMs ?? 0, 'delayMs');
    if (event.type === 'train') {
      if (trackMode !== 'rails') {
        throw new Error(`[coopDefenseMaps] Map ${mapId} declares a train event but no rails (trackMode: ${trackMode})`);
      }
      const repeatAfterExitMs = event.repeatAfterExitMs === undefined
        ? undefined
        : normalizeMapEventMilliseconds(mapId, event.id, event.repeatAfterExitMs, 'repeatAfterExitMs', true);
      return {
        id: event.id,
        type: 'train',
        start,
        delayMs,
        ...(repeatAfterExitMs === undefined ? {} : { repeatAfterExitMs }),
      };
    }
    if (event.type === 'airstrike') {
      return normalizeAirstrikeMapEvent(
        mapId,
        event,
        start,
        delayMs,
        arenaWidthCells,
        arenaHeightCells,
      );
    }
    if (event.type === 'ground-hazard') {
      return normalizeGroundHazardMapEvent(
        mapId,
        event,
        start,
        delayMs,
        arenaWidthCells,
        arenaHeightCells,
      );
    }
    throw new Error(`[coopDefenseMaps] Map ${mapId} has an unsupported map event type: ${event.type}`);
  });
}

function normalizeGroundHazardMapEvent(
  mapId: string,
  event: CoopDefenseMapGroundHazardEventConfig,
  start: CoopDefenseMapEventStart,
  delayMs: number,
  arenaWidthCells: number,
  arenaHeightCells: number,
): ResolvedCoopDefenseMapGroundHazardEventConfig {
  const durationMs = event.durationMs === undefined
    ? undefined
    : normalizeMapEventMilliseconds(mapId, event.id, event.durationMs, 'durationMs', true);
  const area = normalizeGroundHazardArea(
    mapId,
    event.id,
    event.area,
    arenaWidthCells,
    arenaHeightCells,
  );
  const effect = event.effect;
  if (!effect || typeof effect !== 'object' || Array.isArray(effect)) {
    throw new Error(`[coopDefenseMaps] Ground hazard event ${mapId}:${event.id} needs an effect`);
  }
  if (effect.visualStyle !== 'normal' && effect.visualStyle !== 'void') {
    throw new Error(`[coopDefenseMaps] Ground hazard event ${mapId}:${event.id} has an unknown visualStyle`);
  }
  if (
    typeof effect.burnDurationMs !== 'number'
    || !Number.isFinite(effect.burnDurationMs)
    || effect.burnDurationMs <= 0
  ) {
    throw new Error(`[coopDefenseMaps] Ground hazard event ${mapId}:${event.id} needs a positive burnDurationMs`);
  }
  if (
    typeof effect.burnDamagePerTick !== 'number'
    || !Number.isFinite(effect.burnDamagePerTick)
    || effect.burnDamagePerTick < 0
  ) {
    throw new Error(`[coopDefenseMaps] Ground hazard event ${mapId}:${event.id} needs a non-negative burnDamagePerTick`);
  }
  if (typeof effect.weaponName !== 'string' || effect.weaponName.trim().length === 0) {
    throw new Error(`[coopDefenseMaps] Ground hazard event ${mapId}:${event.id} needs a weaponName`);
  }
  const burnDurationMs = Math.floor(effect.burnDurationMs);
  if (burnDurationMs <= 0) {
    throw new Error(`[coopDefenseMaps] Ground hazard event ${mapId}:${event.id} needs a positive burnDurationMs`);
  }
  return {
    id: event.id,
    type: 'ground-hazard',
    start,
    delayMs,
    ...(durationMs === undefined ? {} : { durationMs }),
    area,
    effect: {
      visualStyle: effect.visualStyle,
      burnDurationMs,
      burnDamagePerTick: effect.burnDamagePerTick,
      weaponName: effect.weaponName.trim(),
    },
  };
}

function normalizeGroundHazardArea(
  mapId: string,
  eventId: string,
  area: CoopDefenseMapGroundHazardArea | undefined,
  arenaWidthCells: number,
  arenaHeightCells: number,
): CoopDefenseMapGroundHazardArea {
  if (!area || typeof area !== 'object' || Array.isArray(area) || typeof area.type !== 'string') {
    throw new Error(`[coopDefenseMaps] Ground hazard event ${mapId}:${eventId} needs a valid area`);
  }
  const baseClearanceCells = normalizeGroundHazardBaseClearance(mapId, eventId, area.baseClearanceCells);
  if (area.type === 'random-patches') {
    if (
      typeof area.minPatchRadiusCells !== 'number'
      || !Number.isFinite(area.minPatchRadiusCells)
      || area.minPatchRadiusCells <= 0
      || typeof area.maxPatchRadiusCells !== 'number'
      || !Number.isFinite(area.maxPatchRadiusCells)
      || area.maxPatchRadiusCells < area.minPatchRadiusCells
    ) {
      throw new Error(`[coopDefenseMaps] Ground hazard event ${mapId}:${eventId} needs valid patch radii`);
    }
    return {
      type: 'random-patches',
      randomPatchCount: normalizePositiveMapEventInteger(
        mapId,
        eventId,
        area.randomPatchCount,
        'randomPatchCount',
      ),
      minPatchRadiusCells: area.minPatchRadiusCells,
      maxPatchRadiusCells: area.maxPatchRadiusCells,
      ...(baseClearanceCells === undefined ? {} : { baseClearanceCells }),
    };
  }
  if (area.type === 'rectangle') {
    const values = [area.gridX, area.gridY, area.widthCells, area.heightCells];
    if (values.some((value) => typeof value !== 'number' || !Number.isInteger(value))) {
      throw new Error(`[coopDefenseMaps] Ground hazard event ${mapId}:${eventId} needs integer rectangle coordinates`);
    }
    if (
      area.gridX < 0
      || area.gridY < 0
      || area.widthCells <= 0
      || area.heightCells <= 0
      || area.gridX + area.widthCells > arenaWidthCells
      || area.gridY + area.heightCells > arenaHeightCells
    ) {
      throw new Error(`[coopDefenseMaps] Ground hazard event ${mapId}:${eventId} rectangle is outside the arena`);
    }
    return {
      type: 'rectangle',
      gridX: area.gridX,
      gridY: area.gridY,
      widthCells: area.widthCells,
      heightCells: area.heightCells,
      ...(baseClearanceCells === undefined ? {} : { baseClearanceCells }),
    };
  }
  if (area.type === 'cells') {
    if (!Array.isArray(area.cells) || area.cells.length === 0) {
      throw new Error(`[coopDefenseMaps] Ground hazard event ${mapId}:${eventId} needs cells`);
    }
    const seen = new Set<string>();
    const cells = area.cells.map((cell) => {
      if (
        !cell
        || typeof cell.gridX !== 'number'
        || typeof cell.gridY !== 'number'
        || !Number.isInteger(cell.gridX)
        || !Number.isInteger(cell.gridY)
        || cell.gridX < 0
        || cell.gridY < 0
        || cell.gridX >= arenaWidthCells
        || cell.gridY >= arenaHeightCells
      ) {
        throw new Error(`[coopDefenseMaps] Ground hazard event ${mapId}:${eventId} has an invalid cell`);
      }
      const key = `${cell.gridX}:${cell.gridY}`;
      if (seen.has(key)) {
        throw new Error(`[coopDefenseMaps] Ground hazard event ${mapId}:${eventId} has duplicate cells`);
      }
      seen.add(key);
      return { gridX: cell.gridX, gridY: cell.gridY };
    });
    return {
      type: 'cells',
      cells,
      ...(baseClearanceCells === undefined ? {} : { baseClearanceCells }),
    };
  }
  throw new Error(`[coopDefenseMaps] Ground hazard event ${mapId}:${eventId} has an unknown area type`);
}

function normalizeGroundHazardBaseClearance(
  mapId: string,
  eventId: string,
  value: number | undefined,
): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
    throw new Error(`[coopDefenseMaps] Ground hazard event ${mapId}:${eventId} needs a non-negative baseClearanceCells`);
  }
  return value;
}

function normalizeAirstrikeMapEvent(
  mapId: string,
  event: CoopDefenseMapAirstrikeEventConfig,
  start: CoopDefenseMapEventStart,
  delayMs: number,
  arenaWidthCells: number,
  arenaHeightCells: number,
): ResolvedCoopDefenseMapAirstrikeEventConfig {
  if (event.pattern === 'player-hunt') {
    if (event.intervalMs === undefined) {
      throw new Error(`[coopDefenseMaps] Airstrike event ${mapId}:${event.id} needs intervalMs for player-hunt`);
    }
    if (event.area !== undefined || event.strikeCount !== undefined || event.orderedSweep !== undefined) {
      throw new Error(`[coopDefenseMaps] Airstrike event ${mapId}:${event.id} has parameters invalid for player-hunt`);
    }
    return {
      id: event.id,
      type: 'airstrike',
      start,
      delayMs,
      pattern: 'player-hunt',
      intervalMs: normalizeMapEventMilliseconds(mapId, event.id, event.intervalMs, 'intervalMs', true),
    };
  }

  if (event.pattern === 'tutorial-sweep') {
    if (event.area !== undefined || event.intervalMs !== undefined || event.orderedSweep !== undefined) {
      throw new Error(`[coopDefenseMaps] Airstrike event ${mapId}:${event.id} has parameters invalid for tutorial-sweep`);
    }
    const strikeCount = event.strikeCount === undefined
      ? undefined
      : normalizePositiveMapEventInteger(mapId, event.id, event.strikeCount, 'strikeCount');
    return {
      id: event.id,
      type: 'airstrike',
      start,
      delayMs,
      pattern: 'tutorial-sweep',
      ...(strikeCount === undefined ? {} : { strikeCount }),
    };
  }

  if (event.pattern === 'zone-barrage') {
    if (event.intervalMs !== undefined) {
      throw new Error(`[coopDefenseMaps] Airstrike event ${mapId}:${event.id} has intervalMs invalid for zone-barrage`);
    }
    if (event.strikeCount === undefined) {
      throw new Error(`[coopDefenseMaps] Airstrike event ${mapId}:${event.id} needs strikeCount for zone-barrage`);
    }
    if (event.area === undefined) {
      throw new Error(`[coopDefenseMaps] Airstrike event ${mapId}:${event.id} needs area for zone-barrage`);
    }
    const area = normalizeAirstrikeArea(mapId, event.id, event.area, arenaWidthCells, arenaHeightCells);
    const orderedSweep = event.orderedSweep === undefined ? false : event.orderedSweep;
    if (typeof orderedSweep !== 'boolean') {
      throw new Error(`[coopDefenseMaps] Airstrike event ${mapId}:${event.id} needs a boolean orderedSweep`);
    }
    return {
      id: event.id,
      type: 'airstrike',
      start,
      delayMs,
      pattern: 'zone-barrage',
      strikeCount: normalizePositiveMapEventInteger(mapId, event.id, event.strikeCount, 'strikeCount'),
      area,
      orderedSweep,
    };
  }

  throw new Error(`[coopDefenseMaps] Airstrike event ${mapId}:${event.id} has an unknown pattern: ${event.pattern}`);
}

function normalizeAirstrikeArea(
  mapId: string,
  eventId: string,
  area: CoopDefenseMapAirstrikeArea,
  arenaWidthCells: number,
  arenaHeightCells: number,
): CoopDefenseMapAirstrikeArea {
  const values = [area.gridX, area.gridY, area.widthCells, area.heightCells];
  if (values.some((value) => typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value))) {
    throw new Error(`[coopDefenseMaps] Airstrike event ${mapId}:${eventId} needs integer area coordinates`);
  }
  if (area.gridX < 0 || area.gridY < 0 || area.widthCells <= 0 || area.heightCells <= 0) {
    throw new Error(`[coopDefenseMaps] Airstrike event ${mapId}:${eventId} needs a positive in-arena area`);
  }
  if (
    area.gridX + area.widthCells > arenaWidthCells
    || area.gridY + area.heightCells > arenaHeightCells
  ) {
    throw new Error(`[coopDefenseMaps] Airstrike event ${mapId}:${eventId} area is outside the arena`);
  }
  return {
    gridX: area.gridX,
    gridY: area.gridY,
    widthCells: area.widthCells,
    heightCells: area.heightCells,
  };
}

function normalizeMapEventStart(
  mapId: string,
  eventId: string,
  start: CoopDefenseMapEventStart | undefined,
  encounters: readonly ResolvedCoopDefenseMapEncounterConfig[],
  context: EncounterTriggerNormalizationContext,
): CoopDefenseMapEventStart {
  if (!start || typeof start.type !== 'string') {
    throw new Error(`[coopDefenseMaps] Map event ${mapId}:${eventId} needs a valid start trigger`);
  }
  if (start.type === 'time') {
    return {
      type: 'time',
      atMs: normalizeMapEventMilliseconds(mapId, eventId, start.atMs, 'time trigger'),
    };
  }
  if (start.type === 'after-encounter') {
    if (typeof start.encounterId !== 'string' || start.encounterId.trim().length === 0) {
      throw new Error(`[coopDefenseMaps] Map event ${mapId}:${eventId} needs an encounter id`);
    }
    const encounterId = start.encounterId.trim();
    if (!encounters.some((encounter) => encounter.id === encounterId)) {
      throw new Error(`[coopDefenseMaps] Map event ${mapId}:${eventId} references unknown encounter: ${encounterId}`);
    }
    return { type: 'after-encounter', encounterId };
  }
  if (start.type === 'boss-phase') {
    if (!Number.isFinite(start.phase) || !Number.isInteger(start.phase) || start.phase !== 2) {
      throw new Error(`[coopDefenseMaps] Map event ${mapId}:${eventId} supports boss phase 2 only`);
    }
    if (!context.boss || context.boss.enemyKind !== 'void-hunter') {
      throw new Error(
        `[coopDefenseMaps] Map event ${mapId}:${eventId} needs a Void Hunter boss for phase 2`,
      );
    }
    return { type: 'boss-phase', phase: 2 };
  }
  if (start.type === 'base-destroyed') {
    if (typeof start.baseId !== 'string' || start.baseId.trim().length === 0) {
      throw new Error(`[coopDefenseMaps] Map event ${mapId}:${eventId} needs a base id`);
    }
    const baseId = start.baseId.trim();
    if (!context.bases.some((base) => base.id === baseId)) {
      throw new Error(`[coopDefenseMaps] Map event ${mapId}:${eventId} references unknown base: ${baseId}`);
    }
    return { type: 'base-destroyed', baseId };
  }
  throw new Error(`[coopDefenseMaps] Map event ${mapId}:${eventId} has an unsupported start trigger`);
}

function normalizeMapEventMilliseconds(
  mapId: string,
  eventId: string,
  value: number | undefined,
  fieldName: string,
  requirePositive = false,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || (requirePositive && value <= 0)) {
    const condition = requirePositive ? 'positive finite' : 'non-negative finite';
    throw new Error(`[coopDefenseMaps] Map event ${mapId}:${eventId} needs a ${condition} ${fieldName}`);
  }
  const normalized = Math.floor(value);
  if (requirePositive && normalized <= 0) {
    throw new Error(`[coopDefenseMaps] Map event ${mapId}:${eventId} needs a positive finite ${fieldName}`);
  }
  return normalized;
}

function normalizePositiveMapEventInteger(
  mapId: string,
  eventId: string,
  value: number | undefined,
  fieldName: string,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
    throw new Error(`[coopDefenseMaps] Map event ${mapId}:${eventId} needs a positive integer ${fieldName}`);
  }
  return value;
}

type MapEventDependencyNode = `encounter:${string}` | `event:${string}`;

function validateMapEventDependencyGraph(
  mapId: string,
  encounters: readonly ResolvedCoopDefenseMapEncounterConfig[],
  events: readonly ResolvedCoopDefenseMapEventConfig[],
): void {
  const encounterIds = new Set(encounters.map((encounter) => encounter.id));
  const eventById = new Map(events.map((event) => [event.id, event]));
  const adjacency = new Map<MapEventDependencyNode, MapEventDependencyNode[]>();
  const addNode = (node: MapEventDependencyNode): void => {
    if (!adjacency.has(node)) adjacency.set(node, []);
  };
  const addDependency = (source: MapEventDependencyNode, dependent: MapEventDependencyNode): void => {
    addNode(source);
    addNode(dependent);
    adjacency.get(source)!.push(dependent);
  };

  for (let index = 0; index < encounters.length; index += 1) {
    const encounter = encounters[index];
    const dependent = `encounter:${encounter.id}` as const;
    addNode(dependent);
    if (encounter.start.type === 'after-previous') {
      const previous = encounters[index - 1];
      if (!previous) {
        throw new Error(`[coopDefenseMaps] Encounter ${mapId}:${encounter.id} has no previous encounter`);
      }
      addDependency(`encounter:${previous.id}`, dependent);
    } else if (encounter.start.type === 'after-encounter') {
      if (!encounterIds.has(encounter.start.encounterId)) {
        throw new Error(
          `[coopDefenseMaps] Encounter ${mapId}:${encounter.id} references unknown encounter: ${encounter.start.encounterId}`,
        );
      }
      addDependency(`encounter:${encounter.start.encounterId}`, dependent);
    } else if (encounter.start.type === 'after-event') {
      const source = eventById.get(encounter.start.eventId);
      if (!source) {
        throw new Error(
          `[coopDefenseMaps] Encounter ${mapId}:${encounter.id} references unknown map event: ${encounter.start.eventId}`,
        );
      }
      if (!isFiniteMapEvent(source)) {
        throw new Error(
          `[coopDefenseMaps] Encounter ${mapId}:${encounter.id} cannot wait for repeatable or persistent event: ${source.id}`,
        );
      }
      addDependency(`event:${source.id}`, dependent);
    }
  }

  for (const event of events) {
    const dependent = `event:${event.id}` as const;
    addNode(dependent);
    if (event.start.type !== 'after-encounter') continue;
    if (!encounterIds.has(event.start.encounterId)) {
      throw new Error(
        `[coopDefenseMaps] Map event ${mapId}:${event.id} references unknown encounter: ${event.start.encounterId}`,
      );
    }
    addDependency(`encounter:${event.start.encounterId}`, dependent);
  }

  const visiting = new Set<MapEventDependencyNode>();
  const visited = new Set<MapEventDependencyNode>();
  const visit = (node: MapEventDependencyNode): void => {
    if (visiting.has(node)) {
      throw new Error(`[coopDefenseMaps] Map ${mapId} has a cyclic encounter/map-event dependency`);
    }
    if (visited.has(node)) return;
    visiting.add(node);
    for (const dependent of adjacency.get(node) ?? []) visit(dependent);
    visiting.delete(node);
    visited.add(node);
  };
  for (const node of adjacency.keys()) visit(node);
}

function isFiniteMapEvent(event: ResolvedCoopDefenseMapEventConfig): boolean {
  if (event.type === 'train') return event.repeatAfterExitMs === undefined;
  if (event.type === 'airstrike') return event.pattern !== 'player-hunt';
  return event.durationMs !== undefined;
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
  if (baseConfig.dormant === true && role === 'main') {
    throw new Error(`[coopDefenseMaps] Dormant mission structure ${baseConfig.id} must not use role main`);
  }
  if (baseConfig.startHpFactor !== undefined) {
    if (typeof baseConfig.startHpFactor !== 'number'
      || !Number.isFinite(baseConfig.startHpFactor)
      || baseConfig.startHpFactor <= 0
      || baseConfig.startHpFactor > 1) {
      throw new Error(
        `[coopDefenseMaps] Base ${baseConfig.id} has an invalid startHpFactor; expected a number in (0, 1]`,
      );
    }
    // Eine angeschlagene Hauptbasis wuerde still das Verlustbudget der Runde veraendern
    // (CoopDefenseRoundStateSystem summiert die HP aller friendly main bases).
    if (role === 'main') {
      throw new Error(`[coopDefenseMaps] Base ${baseConfig.id} must not use startHpFactor with role main`);
    }
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
    ...(baseConfig.startHpFactor === undefined ? {} : { startHpFactor: baseConfig.startHpFactor }),
    playerScaling: normalizeBasePlayerScaling(baseConfig.playerScaling),
    faction,
    role,
    dormant: baseConfig.dormant === true,
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
    && turret.weaponId !== 'TURRET_ROCKET_BURST'
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
