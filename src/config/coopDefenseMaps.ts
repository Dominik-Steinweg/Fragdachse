import { COOP_DEFENSE_MAP_REGISTRY } from './coopDefenseMaps/index';
import rawWeaponBalanceLabMap from './coopDefenseMaps/weapon-balance-lab.internal.json';
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
import { COOP_DEFENSE_TUTORIAL_STEP_DEFAULT_DURATION_MS } from './coopDefenseTutorial';
import { DEFAULT_TIME_OF_DAY_MINUTES, formatTimeOfDay, parseTimeOfDay } from '../effects/TimeOfDay';
import { normalizeCoopDefensePlayerScalingFactor } from './coopDefenseScaling';
import type { GroundFireVisualStyle, SpawnFront } from '../types';
import { DEFAULT_SPAWN_FRONT, isSpawnFront } from '../utils/spawnFront';
import { MAX_PERSISTENT_BASE_RADIUS_CELLS, PERSISTENT_BASE_CLEARANCE_CELLS } from './persistentBase';
import {
  buildPersistentBaseCoreBaseConfig,
  isPersistentBaseBuildArea,
  isPersistentBaseOrientation,
  type PersistentBaseBuildArea,
  type PersistentBaseOrientation,
} from '../persistentBase/PersistentBaseCore';
import type { PersistentBaseAnchor } from '../persistentBase/PersistentBaseTypes';

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
  | 'SPORES'
  | 'BASE_SPORES'
  | 'SPORE_TURRET_PLASMA'
  | 'TURRET_ROCKET_BURST'
  | 'TURRET_MG'
  | 'TURRET_FLAME'
  | 'TURRET_VOID_FLAME'
  | 'TURRET_SPORES';

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

/**
 * Rechteckiger Spawnbereich in Arenazellen.
 *
 * Eine Spawnfront ist ein Randband der ganzen Arena. Auf einer langen Routenkarte liegt dieses
 * Band fast immer im falschen Abschnitt, deshalb darf eine Gruppe ihren Bereich stattdessen
 * ausdruecklich authoren. Die Auswahl innerhalb des Bereichs bleibt die bestehende: begehbar,
 * erreichbar und nicht in einem anderen Gegner.
 */
export interface CoopDefenseMapSpawnAreaConfig {
  readonly gridX: number;
  readonly gridY: number;
  readonly widthCells: number;
  readonly heightCells: number;
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
  /** Ersetzt das Frontband durch einen authored Bereich; schliesst `front` aus. */
  readonly spawnArea?: CoopDefenseMapSpawnAreaConfig;
}

/** Kleine, bewusst typisierte Startbedingungen fuer einen endlichen Encounter. */
export type CoopDefenseMapEncounterStart =
  | { readonly type: 'time'; readonly atMs: number }
  | { readonly type: 'after-previous' }
  | { readonly type: 'after-encounter'; readonly encounterId: string }
  | { readonly type: 'after-checkpoint'; readonly checkpointId: string }
  | { readonly type: 'after-defense'; readonly defenseId: string }
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
  readonly spawnArea?: CoopDefenseMapSpawnAreaConfig;
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
   * Nur fuer `hold` und dort Pflicht: Zeitpunkt, bis zu dem die Ziele leben muessen. Hold besitzt
   * keinen Hintergrundzustand – dieses Fenster ist zugleich sein Fokusfenster.
   */
  readonly holdUntil?: CoopDefenseMapEncounterStart;
  /** Nur fuer `hold`: relative Dauer ab tatsaechlicher Aktivierung in Host-Rundenzeit. */
  readonly holdDurationMs?: number;
  /** Nur fuer `hold`: Mindestanzahl der Zielbasen, die das Haltefenster ueberleben muessen. */
  readonly requiredSurvivors?: number;
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
}

export interface ResolvedCoopDefenseMapSecondaryObjectiveConfig {
  readonly id: string;
  readonly type: CoopDefenseSecondaryObjectiveType;
  readonly start: CoopDefenseMapEncounterStart;
  readonly focusUntil?: CoopDefenseMapEncounterStart;
  readonly holdUntil?: CoopDefenseMapEncounterStart;
  readonly holdDurationMs?: number;
  readonly requiredSurvivors?: number;
  readonly targets: readonly string[];
  readonly targetGoal: number;
  readonly carry?: CoopDefenseMapCarryConfig;
  readonly rewards?: CoopDefenseMapSecondaryObjectiveRewards;
}

// Kurze Aliasnamen halten den Vertrag für Systeme/Tests lesbar, ohne die Map-Config-Namensfamilie
// der bestehenden Encounter- und Spawndefinitionen aufzubrechen.
export type CoopDefenseSecondaryObjectiveConfig = CoopDefenseMapSecondaryObjectiveConfig;
export type ResolvedCoopDefenseSecondaryObjectiveConfig = ResolvedCoopDefenseMapSecondaryObjectiveConfig;

export interface CoopDefenseMapMissionCheckpointConfig {
  readonly id: string;
  readonly gridX: number;
  readonly gridY: number;
  /** Radius in Rasterzellen; Standard 1. */
  readonly radiusCells?: number;
  readonly setRespawn?: boolean;
}

export interface ResolvedCoopDefenseMapMissionCheckpointConfig extends CoopDefenseMapMissionCheckpointConfig {
  readonly radiusCells: number;
  readonly setRespawn: boolean;
}

export type CoopDefenseMapMissionBarrierOpenTrigger =
  | { readonly type: 'after-checkpoint'; readonly checkpointId: string }
  | { readonly type: 'after-defense'; readonly defenseId: string }
  | { readonly type: 'after-encounter'; readonly encounterId: string };

export interface CoopDefenseMapMissionBarrierConfig {
  readonly id: string;
  readonly cells: readonly { readonly gridX: number; readonly gridY: number }[];
  readonly openOn: CoopDefenseMapMissionBarrierOpenTrigger;
}

export interface CoopDefenseMapMandatoryDefenseConfig {
  readonly id: string;
  readonly checkpointId: string;
  readonly objectiveId: string;
  /**
   * Gesetzt: Ein gescheitertes Hold beendet die Mission als Niederlage, statt die Route nur
   * ohne Reward freizugeben. Gedacht fuer Stellungen, ohne die der Vorstoss keinen Sinn mehr
   * ergibt. Ohne Angabe bleibt es bei der bestehenden Semantik `failed` = aufgeloest.
   */
  readonly failureEndsMission?: boolean;
}

export interface ResolvedCoopDefenseMapMandatoryDefenseConfig extends CoopDefenseMapMandatoryDefenseConfig {
  readonly failureEndsMission: boolean;
}

/**
 * Bevorzugter Startbereich der Route. Er ersetzt keine Spawnzelle, sondern gibt der
 * vorhandenen sicheren Spawnbewertung denselben Fokus, den spaeter ein aktivierter
 * `setRespawn`-Checkpoint uebernimmt. Ohne ihn waere der Initialspawn einer langen
 * Routenkarte ueber die gesamte Arena verteilt.
 */
export interface CoopDefenseMapMissionStartAreaConfig {
  readonly gridX: number;
  readonly gridY: number;
  readonly radiusCells?: number;
}

export interface ResolvedCoopDefenseMapMissionStartAreaConfig
  extends CoopDefenseMapMissionStartAreaConfig {
  readonly radiusCells: number;
}

export interface CoopDefenseMapMissionProgressConfig {
  readonly checkpoints: readonly CoopDefenseMapMissionCheckpointConfig[];
  readonly barriers?: readonly CoopDefenseMapMissionBarrierConfig[];
  readonly mandatoryDefenses?: readonly CoopDefenseMapMandatoryDefenseConfig[];
  readonly startArea?: CoopDefenseMapMissionStartAreaConfig;
}

export interface ResolvedCoopDefenseMapMissionProgressConfig {
  readonly checkpoints: readonly ResolvedCoopDefenseMapMissionCheckpointConfig[];
  readonly barriers: readonly CoopDefenseMapMissionBarrierConfig[];
  readonly mandatoryDefenses: readonly ResolvedCoopDefenseMapMandatoryDefenseConfig[];
  readonly startArea?: ResolvedCoopDefenseMapMissionStartAreaConfig;
}

export interface CoopDefenseMapBossConfig {
  readonly enemyKind: CoopDefenseEnemyKind;
  readonly spawnAtMs: number;
}

export type CoopDefenseTimeOfDayTransitionStart =
  | { readonly type: 'time'; readonly atMs: number }
  | { readonly type: 'boss-spawn' }
  | { readonly type: 'boss-phase'; readonly phase: number };

export interface CoopDefenseTimeOfDayTransitionConfig {
  readonly start: CoopDefenseTimeOfDayTransitionStart;
  readonly targetTimeOfDay: string;
  /** 0 ist ein sofortiger Zustandswechsel; positive Werte werden per Smoothstep interpoliert. */
  readonly durationMs: number;
}

/**
 * Optionale, rein visuelle Laufzeitsteuerung der Arena-Uhr. Alle zeitbasierten Werte werden
 * gegen den replizierten Rundenstart ausgewertet; es gibt keinen eigenen Tick oder
 * hochfrequenten Wire-State. Ein erfolgreicher Boss-Spawn publiziert genau einen reliable Anker.
 */
export interface CoopDefenseDynamicTimeOfDayConfig {
  /** Spielminuten pro realer Sekunde. Fehlt der Wert, bleibt die Uhr zwischen Transitionen stehen. */
  readonly minutesPerSecond?: number;
  /** Vorwaerts laufende Zielwechsel; Bossphasen duerfen nur als sofortige Endzustaende folgen. */
  readonly transitions?: readonly CoopDefenseTimeOfDayTransitionConfig[];
}

/**
 * Siegbedingung der Map.
 *
 * Jede Map hat genau ein Ziel: einen endlichen Assault abwehren, Zeit ueberleben, den Boss
 * besiegen, alle feindlichen Basen zerstoeren oder die authored Route bis zur Extraktion
 * durchqueren. Verloren wird ueber die eigenen Basen; `survive` und `advance` verlieren
 * stattdessen ueber den endgueltigen Team-Wipe.
 */
export type CoopDefenseMapObjective =
  | 'repel-assault'
  | 'survive'
  | 'defeat-boss'
  | 'destroy-hostile-bases'
  | 'advance';

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

/** Authoring-Position der zweispaltigen vertikalen Gleise. */
export type CoopDefenseMapTrackPosition =
  | 'left'
  | 'center'
  | 'right'
  | { readonly kind: 'grid'; readonly gridX: number };

/**
 * Startbedingung eines Map-Events. Bewusst als getaggte Union wie
 * {@link CoopDefenseMapEncounterStart}, damit semantische Auslöser ohne eine allgemeine
 * Trigger-Engine authoriert werden können.
 */
/** Kleine Triggerunion fuer alle C-Events. */
export type CoopDefenseMapEventStart =
  | { readonly type: 'time'; readonly atMs: number }
  | { readonly type: 'after-checkpoint'; readonly checkpointId: string }
  | { readonly type: 'after-encounter'; readonly encounterId: string }
  | { readonly type: 'after-event'; readonly eventId: string }
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
  readonly sourceId: string;
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

/**
 * Ein authored Band aus regulaeren zerstoerbaren Felsen. Es ist keine Missionsbarriere: Es
 * blockiert nur so lange, wie es steht, und jede vorhandene Zerstoerungs- oder
 * Bewegungsmechanik loest es auf dieselbe Weise auf wie generierten Fels.
 */
export interface CoopDefenseMapRockWallConfig {
  readonly id: string;
  readonly gridX: number;
  readonly gridY: number;
  readonly widthCells: number;
  readonly heightCells: number;
}

/** Authored Position des Tutorial-Fensters; `gridX` ist seine Mittelspalte. */
export interface CoopDefenseMapTutorialAnchorConfig {
  readonly gridX: number;
  readonly gridY: number;
}

/**
 * Ein gemeinsamer Tutorial-Hinweis. Ausgeloest wird er, sobald der hostautoritative
 * Missionszustand den zugehoerigen Checkpoint aktiviert; danach sehen ihn alle Clients.
 */
export interface CoopDefenseMapTutorialStepConfig {
  readonly id: string;
  readonly checkpointId: string;
  /** Weltposition des Step-Fensters; der Checkpoint bleibt ausschließlich sein Trigger. */
  readonly anchor?: CoopDefenseMapTutorialAnchorConfig;
  readonly durationMs?: number;
}

/**
 * Die persistente Basisstelle einer Map.
 *
 * Sie beschreibt ausschliesslich *wo* der Basiskern steht und welche Baubereich-Regel gilt, nie
 * einzelne Kernzellen: Seine Form kommt aus
 * {@link import('../persistentBase/PersistentBaseCore').CANONICAL_PERSISTENT_BASE_CORE_CELLS}.
 * Deshalb traegt keine Map eigene Basiszellen, und zwei Maps koennen ihre Basisdefinition nicht
 * auseinanderlaufen lassen. Die Normalisierung erzeugt aus diesem Block den `bases`-Eintrag mit
 * der angegebenen `baseId`; ein gleichnamiger authored Eintrag ist ein Fehler.
 */
export interface CoopDefenseMapPersistentBaseConfig {
  readonly baseId: string;
  /** Kanonischer Bezugspunkt des Kerns: die Mittelzelle seiner 5x5-Grundflaeche. */
  readonly anchor: PersistentBaseAnchor;
  /** Ohne Angabe die kanonische Ausrichtung. */
  readonly orientation?: PersistentBaseOrientation;
  /** Ohne Angabe der aktuelle feste 3x3-Innenhof; spaetere Stufen koennen einen Radius nutzen. */
  readonly buildArea?: PersistentBaseBuildArea;
  readonly hpMax: number;
}

export interface ResolvedCoopDefenseMapTutorialStepConfig extends CoopDefenseMapTutorialStepConfig {
  readonly durationMs: number;
}

export interface CoopDefenseMapConfig {
  readonly mapId: string;
  /**
   * Horizontale Arenabreite im 32-px-Raster. Standard sind 60 Zellen; Werte werden auf
   * `MAX_COOP_DEFENSE_ARENA_WIDTH_CELLS` begrenzt.
   */
  readonly arenaWidthCells?: number;
  /** Vertikale Arenahoehe im 32-px-Raster; ohne Angabe bleibt die bestehende Hoehe aktiv. */
  readonly arenaHeightCells?: number;
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
  /** Authored Baumzahl; ohne Angabe gilt der globale Arena-Standard. */
  readonly treeCount?: number;
  /** Gesetzt: zugebautes Felsfeld mit festen Gängen statt prozeduraler Felsverteilung. */
  readonly rockField?: CoopDefenseMapRockFieldConfig;
  /**
   * Authored Felsbaender aus ganz normalen zerstoerbaren Felsen. Sie werden erst nach
   * Konnektivitaets-, Baum- und Routenpruefung gestempelt: Der Generator soll ein bewusst
   * gesetztes Band nicht als abgeschnuertes Gebiet auffassen und wieder aufschneiden.
   * Gleisspalten, Basisreservierungen und Barrierezellen bleiben frei.
   */
  readonly rockWalls?: readonly CoopDefenseMapRockWallConfig[];
  /**
   * Verschiebt Tutorial-Fenster und die Felsformation darunter an eine authored Zelle.
   * `gridX` ist die Mittelspalte des Fensters, `gridY` seine obere Zeile. Ohne Angabe bleibt
   * das Fenster in der Arenamitte auf der bisherigen Hoehe.
   */
  readonly tutorialAnchor?: CoopDefenseMapTutorialAnchorConfig;
  /**
   * Gemeinsame Tutorial-Hinweise entlang der Route. Sie besitzen keine Gameplay-Autoritaet;
   * ihre Sichtbarkeit leitet sich aus den replizierten Checkpoint-Aktivierungen ab.
   */
  readonly tutorialSteps?: readonly ResolvedCoopDefenseMapTutorialStepConfig[]
  | readonly CoopDefenseMapTutorialStepConfig[];
  /** Standard `rails`; `void-fire` reserviert denselben Korridor, erzeugt aber keine Gleise. */
  readonly trackMode?: CoopDefenseMapTrackMode;
  /** Position der zweispaltigen Gleise; Standard `center`. `gridX` bezeichnet die linke Spalte. */
  readonly trackPosition?: CoopDefenseMapTrackPosition;
  /** Authored Map-Events; Gleise ohne Zug-Event bleiben erlaubt. */
  readonly mapEvents?: readonly CoopDefenseMapEventConfig[];
  /**
   * Uhrzeit, zu der die Map startet, als `"HH:MM"` (Standard `"12:00"`). Sie steuert
   * Grundhelligkeit und Färbung der Arena, Länge und Deckkraft der statischen Schatten
   * sowie ob Spieler eine Taschenlampe tragen – stufenlos, ohne Sprung zwischen Tag und
   * Nacht. Optionale Laufzeitänderungen stehen in `dynamicTimeOfDay`; die gemeinsame Kurve
   * liegt in `effects/TimeOfDay.ts`.
   *
   * Der Startwert wird auf Host und Clients lokal aus der bereits replizierten Map-ID
   * abgeleitet. Nur ein tatsaechlicher Boss-Spawn ergaenzt bei Bedarf einmalig seinen
   * reliable RoundState-Anker.
   */
  readonly timeOfDay?: string;
  /** Optionale kontinuierliche bzw. gescriptete Laufzeitsteuerung; ohne Angabe bleibt die Map statisch. */
  readonly dynamicTimeOfDay?: CoopDefenseDynamicTimeOfDayConfig;
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
  /** Optionaler, geordneter Vorstoss-Pfad. Verteidigung selbst bleibt ein Hold-Secondary-Objective. */
  readonly missionProgress?: ResolvedCoopDefenseMapMissionProgressConfig | CoopDefenseMapMissionProgressConfig;
  readonly boss?: CoopDefenseMapBossConfig;
  /** Jede Map muss ihr Ziel explizit konfigurieren. */
  readonly objective: CoopDefenseMapObjective;
  /** Zwingend fuer jedes Ziel, das ueber den Team-Wipe verliert: begrenzte persoenliche Respawns. */
  readonly respawnsPerPlayer?: number;
  /** Gesetzt: Ein Sieg auf dieser Map bietet dem Spieler drei Items zur Auswahl an. */
  readonly itemDrop?: CoopDefenseMapItemDropConfig;
  /** Reuses the authored friendly main base as the persistent anchor. */
  readonly persistentBase?: CoopDefenseMapPersistentBaseConfig;
}

/** Maschinenlesbarer Kampagnen-Audit fuer das GDD-Review und Balancing-Tools. */
export interface CoopDefenseCampaignAuditEntry {
  readonly mapId: string;
  readonly displayName: string;
  readonly objective: CoopDefenseMapObjective;
  readonly arena: { readonly widthCells: number; readonly heightCells: number };
  readonly tutorial: boolean;
  readonly targetDurationSec: number;
  readonly encounterIds: readonly string[];
  readonly triggers: readonly { readonly id: string; readonly kind: 'encounter' | 'event'; readonly type: string }[];
  readonly finiteXp: number;
  readonly persistentSpawns: readonly string[];
  readonly secondaryObjectives: readonly string[];
  readonly events: readonly { readonly id: string; readonly type: CoopDefenseMapEventConfig['type'] }[];
  readonly boss: string | null;
  readonly bases: readonly { readonly id: string; readonly role: CoopBaseRole; readonly faction: CoopBaseFaction }[];
  readonly outposts: readonly string[];
  readonly spawnStructures: readonly string[];
  readonly itemLevel: number | null;
  readonly rockField: boolean;
  readonly train: boolean;
  readonly hazards: readonly string[];
}

/** Registry maps are normalized at load; systems use this narrow resolved view. */
export function resolveCoopDefenseMapMissionProgress(
  mapConfig: CoopDefenseMapConfig,
): ResolvedCoopDefenseMapMissionProgressConfig | undefined {
  return mapConfig.missionProgress as ResolvedCoopDefenseMapMissionProgressConfig | undefined;
}

/** Gemeinsame Tutorial-Schritte der Map; leer, solange keine authoriert sind. */
export function resolveCoopDefenseMapTutorialSteps(
  mapConfig: CoopDefenseMapConfig,
): readonly ResolvedCoopDefenseMapTutorialStepConfig[] {
  return (mapConfig.tutorialSteps ?? []) as readonly ResolvedCoopDefenseMapTutorialStepConfig[];
}

interface CoopDefenseMapRegistryFile {
  readonly defaultMapId: string;
  readonly maps: readonly CoopDefenseMapConfig[];
}

const NORMALIZED_COOP_DEFENSE_MAP_REGISTRY = normalizeMapRegistry(
  COOP_DEFENSE_MAP_REGISTRY as CoopDefenseMapRegistryFile,
);

/** Interne Debug-Map; bewusst nicht Teil der auswählbaren Kampagnenregistry. */
export const WEAPON_BALANCE_LAB_MAP_ID = 'weapon-balance-lab';
const WEAPON_BALANCE_LAB_MAP_CONFIG = normalizeCoopDefenseMapConfig(
  rawWeaponBalanceLabMap as CoopDefenseMapConfig,
);

export function isWeaponBalanceLabMapId(mapId: string | null | undefined): boolean {
  return mapId === WEAPON_BALANCE_LAB_MAP_ID;
}

export const COOP_DEFENSE_MAP_CONFIGS = NORMALIZED_COOP_DEFENSE_MAP_REGISTRY.maps;
export const DEFAULT_COOP_DEFENSE_MAP_ID = NORMALIZED_COOP_DEFENSE_MAP_REGISTRY.defaultMapId;

const MAPS_BY_ID = new Map<string, CoopDefenseMapConfig>(
  [
    ...COOP_DEFENSE_MAP_CONFIGS.map((mapConfig) => [mapConfig.mapId, mapConfig] as const),
    [WEAPON_BALANCE_LAB_MAP_CONFIG.mapId, WEAPON_BALANCE_LAB_MAP_CONFIG] as const,
  ],
);

export function getCoopDefenseMapConfig(mapId: string): CoopDefenseMapConfig {
  return MAPS_BY_ID.get(mapId) ?? getDefaultCoopDefenseMapConfig();
}

export function getCoopDefenseCampaignAudit(): readonly CoopDefenseCampaignAuditEntry[] {
  return COOP_DEFENSE_MAP_CONFIGS.map((mapConfig) => ({
    mapId: mapConfig.mapId,
    displayName: `Map ${mapConfig.mapId}`,
    objective: mapConfig.objective,
    arena: {
      widthCells: mapConfig.arenaWidthCells ?? DEFAULT_COOP_DEFENSE_ARENA_WIDTH_CELLS,
      heightCells: mapConfig.arenaHeightCells ?? DEFAULT_COOP_DEFENSE_ARENA_HEIGHT_CELLS,
    },
    tutorial: mapConfig.tutorialPersistent === true || mapConfig.tutorialShowControls === true,
    targetDurationSec: mapConfig.surviveDurationSec ?? mapConfig.balanceReferenceDurationSec,
    encounterIds: (mapConfig.encounters ?? []).map((encounter) => encounter.id),
    triggers: [
      ...(mapConfig.encounters ?? []).map((encounter) => ({
        id: encounter.id,
        kind: 'encounter' as const,
        type: encounter.start.type,
      })),
      ...(mapConfig.mapEvents ?? []).map((event) => ({
        id: event.id,
        kind: 'event' as const,
        type: event.start.type,
      })),
    ],
    finiteXp: getCoopDefenseMapScheduledXp(mapConfig),
    persistentSpawns: (mapConfig.persistentSpawns ?? []).map((spawn) => spawn.id),
    secondaryObjectives: (mapConfig.secondaryObjectives ?? []).map((objective) => `${objective.id}:${objective.type}`),
    events: (mapConfig.mapEvents ?? []).map((event) => ({ id: event.id, type: event.type })),
    boss: mapConfig.boss?.enemyKind ?? null,
    bases: mapConfig.bases.map((base) => ({
      id: base.id,
      role: base.role ?? 'main',
      faction: base.faction ?? 'friendly',
    })),
    outposts: mapConfig.bases.filter((base) => (base.role ?? 'main') === 'outpost').map((base) => base.id),
    spawnStructures: mapConfig.bases
      .filter((base) => (base.role ?? 'main') === 'spawn-point')
      .map((base) => base.id),
    itemLevel: mapConfig.itemDrop?.itemLevel ?? null,
    rockField: mapConfig.rockField !== undefined,
    train: (mapConfig.mapEvents ?? []).some((event) => event.type === 'train'),
    hazards: (mapConfig.mapEvents ?? [])
      .filter((event): event is CoopDefenseMapGroundHazardEventConfig => event.type === 'ground-hazard')
      .map((event) => event.id),
  }));
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
        ...(group.spawnArea ? { spawnArea: { ...group.spawnArea } } : {}),
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
    ...(objective.holdDurationMs === undefined ? {} : { holdDurationMs: objective.holdDurationMs }),
    ...(objective.requiredSurvivors === undefined ? {} : { requiredSurvivors: objective.requiredSurvivors }),
    targets: [...(objective.targets ?? [])],
    targetGoal: objective.targetGoal ?? (objective.type === 'carry' && objective.carry
      ? objective.carry.itemCount ?? 1
      : objective.targets.length),
    ...(objective.carry ? { carry: cloneCarryConfig(objective.carry) } : {}),
    ...(objective.rewards ? { rewards: { ...objective.rewards } } : {}),
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
  const campaignIds = maps.filter((mapConfig) => mapConfig.mapId !== '0').map((mapConfig) => mapConfig.mapId);
  const expectedCampaignIds = campaignIds.map((_, index) => String(index + 1));
  if (campaignIds.length !== 19 || campaignIds.some((mapId, index) => mapId !== expectedCampaignIds[index])) {
    throw new Error('[coopDefenseMaps] Campaign registry must contain exactly maps 1 through 19 in order');
  }
  return {
    defaultMapId: registry.defaultMapId,
    maps,
  };
}

export function normalizeCoopDefenseMapConfig(mapConfig: CoopDefenseMapConfig): CoopDefenseMapConfig {
  const uniqueBaseIds = new Set<string>();
  const authoredBases = mapConfig.bases.map((baseConfig) => {
    if (uniqueBaseIds.has(baseConfig.id)) {
      throw new Error(`[coopDefenseMaps] Duplicate base id in map ${mapConfig.mapId}: ${baseConfig.id}`);
    }
    uniqueBaseIds.add(baseConfig.id);
    return normalizeBaseConfig(baseConfig);
  });
  // Die Arena-Masse stehen vor den Basen, weil die persistente Basisstelle ihren Anker gegen sie
  // prueft und ihr Kern anschliessend eine ganz normale Basis dieser Map ist.
  const arenaWidthCells = normalizeCoopDefenseArenaWidthCells(
    mapConfig.arenaWidthCells ?? DEFAULT_COOP_DEFENSE_ARENA_WIDTH_CELLS,
  );
  const arenaHeightCells = normalizeCoopDefenseArenaHeightCells(
    mapConfig.arenaHeightCells ?? DEFAULT_COOP_DEFENSE_ARENA_HEIGHT_CELLS,
  );
  const persistentBaseCore = normalizePersistentBaseConfig(
    mapConfig.mapId,
    mapConfig.persistentBase,
    authoredBases,
    arenaWidthCells,
    arenaHeightCells,
  );
  const persistentBase = persistentBaseCore?.site;
  // Der Kern ist ab hier eine gewoehnliche Basis: Missionsziel, Overlays, Generator-Clearance und
  // Flow-Field sehen keinen Unterschied zu einer authored Hauptbasis.
  const bases = persistentBaseCore
    ? [...authoredBases, persistentBaseCore.base]
    : authoredBases;
  const boss = normalizeBossConfig(mapConfig);
  const objective = normalizeObjective(mapConfig.mapId, mapConfig.objective, bases, boss);
  const persistentSpawns = Array.isArray(mapConfig.persistentSpawns) ? mapConfig.persistentSpawns : [];
  validateMapSpawnModel(mapConfig.mapId, objective, mapConfig.encounters);
  // Vorstoss besitzt keine Basis-Niederlage und braucht deshalb wie survive keine eigene Basis.
  if (objective !== 'survive' && objective !== 'advance') validateFriendlyMainBase(mapConfig.mapId, bases);
  const surviveDurationSec = normalizeSurviveDurationSec(mapConfig.mapId, objective, mapConfig.surviveDurationSec);
  const balanceReferenceDurationSec = normalizeBalanceReferenceDurationSec(
    mapConfig.mapId,
    mapConfig.balanceReferenceDurationSec,
  );
  const encounters = normalizeEncounterConfigs(mapConfig.mapId, mapConfig.encounters, {
    bases,
    boss,
    arenaWidthCells,
    arenaHeightCells,
  });
  const trackMode: CoopDefenseMapTrackMode = mapConfig.trackMode === 'void-fire' ? 'void-fire' : 'rails';
  const trackPosition = normalizeTrackPosition(
    mapConfig.mapId,
    mapConfig.trackPosition,
    arenaWidthCells,
  );
  const mapEvents = normalizeMapEvents(
    mapConfig.mapId,
    mapConfig.mapEvents,
    encounters ?? [],
    bases,
    boss,
    trackMode,
    arenaWidthCells,
    arenaHeightCells,
    new Set(mapConfig.missionProgress?.checkpoints.map((checkpoint) => checkpoint.id) ?? []),
  );
  const itemDrop = normalizeItemDropConfig(mapConfig.mapId, mapConfig.itemDrop);
  const secondaryObjectives = normalizeSecondaryObjectiveConfigs(mapConfig.mapId, mapConfig.secondaryObjectives, {
    bases,
    encounters,
    objective,
    itemDrop,
    arenaWidthCells,
    arenaHeightCells,
  });
  const missionProgress = normalizeMissionProgressConfig(
    mapConfig.mapId,
    mapConfig.missionProgress,
    arenaWidthCells,
    arenaHeightCells,
    encounters ?? [],
    secondaryObjectives ?? [],
  );
  validateMissionDependencyGraph(
    mapConfig.mapId,
    encounters ?? [],
    mapEvents,
    secondaryObjectives ?? [],
    missionProgress,
  );
  validateAdvanceRoute(mapConfig.mapId, objective, missionProgress);
  const rockWalls = normalizeRockWallConfigs(
    mapConfig.mapId,
    mapConfig.rockWalls,
    arenaWidthCells,
    arenaHeightCells,
    missionProgress,
  );
  const tutorialAnchor = normalizeTutorialAnchor(
    mapConfig.mapId,
    mapConfig.tutorialAnchor,
    arenaWidthCells,
    arenaHeightCells,
  );
  const tutorialSteps = normalizeTutorialSteps(
    mapConfig.mapId,
    mapConfig.tutorialSteps,
    missionProgress,
    arenaWidthCells,
    arenaHeightCells,
  );
  return {
    mapId: mapConfig.mapId,
    arenaWidthCells: normalizeCoopDefenseArenaWidthCells(
      mapConfig.arenaWidthCells ?? DEFAULT_COOP_DEFENSE_ARENA_WIDTH_CELLS,
    ),
    arenaHeightCells: normalizeCoopDefenseArenaHeightCells(
      mapConfig.arenaHeightCells ?? DEFAULT_COOP_DEFENSE_ARENA_HEIGHT_CELLS,
    ),
    tutorialDurationMs: typeof mapConfig.tutorialDurationMs === 'number' && Number.isFinite(mapConfig.tutorialDurationMs)
      ? Math.max(1000, Math.floor(mapConfig.tutorialDurationMs))
      : undefined,
    tutorialPersistent: mapConfig.tutorialPersistent === true,
    tutorialShowControls: mapConfig.tutorialShowControls === true,
    rockFillRatio: normalizeRockFillRatio(mapConfig.rockFillRatio),
    treeCount: normalizeTreeCount(mapConfig.treeCount),
    rockField: normalizeRockFieldConfig(mapConfig.mapId, mapConfig.rockField),
    rockWalls,
    tutorialAnchor,
    tutorialSteps,
    trackMode,
    trackPosition,
    mapEvents,
    timeOfDay: normalizeTimeOfDayValue(mapConfig.mapId, mapConfig.timeOfDay),
    dynamicTimeOfDay: normalizeDynamicTimeOfDayConfig(mapConfig.mapId, mapConfig.dynamicTimeOfDay, boss),
    tutorialRockArmorDropMult: normalizeTutorialRockArmorDropMult(mapConfig.tutorialRockArmorDropMult),
    surviveDurationSec,
    balanceReferenceDurationSec,
    bases,
    powerUps: mapConfig.powerUps.map((powerUpConfig) => normalizePowerUpConfig(mapConfig.mapId, powerUpConfig)),
    persistentSpawns: normalizePersistentSpawnConfigs(mapConfig.mapId, persistentSpawns, bases),
    encounters,
    secondaryObjectives,
    missionProgress,
    boss,
    objective,
    respawnsPerPlayer: normalizeRespawnsPerPlayer(
      mapConfig.mapId,
      objective,
      mapConfig.respawnsPerPlayer,
    ),
    itemDrop,
    persistentBase,
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

/**
 * Vorstoss fuehrt keine eigene Routenkonfiguration: die authored Checkpoint-Reihenfolge des
 * Missionsfortschritts *ist* die Route, ihr letzter Checkpoint die Extraktion.
 */
function validateAdvanceRoute(
  mapId: string,
  objective: CoopDefenseMapObjective,
  missionProgress: ResolvedCoopDefenseMapMissionProgressConfig | undefined,
): void {
  if (objective !== 'advance') return;
  if (!missionProgress || missionProgress.checkpoints.length === 0) {
    throw new Error(`[coopDefenseMaps] Advance map ${mapId} needs missionProgress with at least one checkpoint`);
  }
}

function validateFriendlyMainBase(mapId: string, bases: readonly CoopBaseConfig[]): void {
  if (!bases.some((baseConfig) => baseConfig.faction !== 'hostile' && (baseConfig.role ?? 'main') === 'main')) {
    throw new Error(`[coopDefenseMaps] Map ${mapId} needs at least one friendly main base`);
  }
}

/**
 * Prueft die authored Basisstelle und erzeugt daraus die Basiskonfiguration des Kerns.
 *
 * Die Map beschreibt nur den Anker; die Zellen kommen aus der kanonischen Kerngeometrie. Ein
 * authored `bases`-Eintrag mit derselben ID waere eine zweite, konkurrierende Beschreibung
 * derselben Basis und wird deshalb abgelehnt.
 */
function normalizePersistentBaseConfig(
  mapId: string,
  config: CoopDefenseMapPersistentBaseConfig | undefined,
  authoredBases: readonly CoopBaseConfig[],
  arenaWidthCells: number,
  arenaHeightCells: number,
): { site: CoopDefenseMapPersistentBaseConfig; base: CoopBaseConfig } | undefined {
  if (config === undefined) return undefined;
  if (typeof config.baseId !== 'string' || config.baseId.trim().length === 0) {
    throw new Error(`[coopDefenseMaps] Persistent base on map ${mapId} needs a non-empty baseId`);
  }
  const baseId = config.baseId.trim();
  if (authoredBases.some((candidate) => candidate.id === baseId)) {
    throw new Error(
      `[coopDefenseMaps] Persistent base ${mapId}:${baseId} must not also be authored in bases; `
      + 'its geometry comes from the canonical core',
    );
  }
  const anchor = config.anchor;
  if (!anchor
    || !Number.isSafeInteger(anchor.gridX)
    || !Number.isSafeInteger(anchor.gridY)) {
    throw new Error(`[coopDefenseMaps] Persistent base ${mapId}:${baseId} needs an integer grid anchor`);
  }
  if (config.orientation !== undefined && !isPersistentBaseOrientation(config.orientation)) {
    throw new Error(`[coopDefenseMaps] Persistent base ${mapId}:${baseId} has an unknown orientation`);
  }
  if (config.buildArea !== undefined && !isPersistentBaseBuildArea(config.buildArea)) {
    throw new Error(`[coopDefenseMaps] Persistent base ${mapId}:${baseId} has an invalid build area`);
  }
  if (!Number.isFinite(config.hpMax) || config.hpMax <= 0) {
    throw new Error(`[coopDefenseMaps] Persistent base ${mapId}:${baseId} needs a positive hpMax`);
  }

  const reservationRadius = MAX_PERSISTENT_BASE_RADIUS_CELLS + PERSISTENT_BASE_CLEARANCE_CELLS;
  if (
    anchor.gridX - reservationRadius < 0
    || anchor.gridX + reservationRadius >= arenaWidthCells
    || anchor.gridY - reservationRadius < 0
    || anchor.gridY + reservationRadius >= arenaHeightCells
  ) {
    throw new Error(
      `[coopDefenseMaps] Persistent base ${mapId}:${baseId} needs ${reservationRadius} free cells around its anchor`,
    );
  }
  const site: CoopDefenseMapPersistentBaseConfig = {
    baseId,
    anchor: { gridX: anchor.gridX, gridY: anchor.gridY },
    ...(config.orientation === undefined ? {} : { orientation: config.orientation }),
    ...(config.buildArea === undefined ? {} : { buildArea: config.buildArea }),
    hpMax: config.hpMax,
  };
  return { site, base: normalizeBaseConfig(buildPersistentBaseCoreBaseConfig(site)) };
}

function getBaseShapeDimensions(shape: CoopBaseShape): { width: number; height: number } {
  if (shape.kind === 'rectangle') {
    return { width: Math.max(1, shape.widthCells), height: Math.max(1, shape.heightCells) };
  }
  let width = 1;
  let height = 1;
  for (const cell of shape.cells) {
    width = Math.max(width, cell.gridX + 1);
    height = Math.max(height, cell.gridY + 1);
  }
  return { width, height };
}

function getBaseOriginForArena(
  anchor: CoopBaseAnchor,
  width: number,
  height: number,
  arenaWidthCells: number,
  arenaHeightCells: number,
): { gridX: number; gridY: number } {
  switch (anchor.kind) {
    case 'right-center':
      return {
        gridX: arenaWidthCells - width - Math.max(0, anchor.edgeInsetCells),
        gridY: Math.floor((arenaHeightCells - height) / 2),
      };
    case 'left-center':
      return {
        gridX: Math.max(0, anchor.edgeInsetCells),
        gridY: Math.floor((arenaHeightCells - height) / 2),
      };
    case 'center-offset':
      return {
        gridX: Math.floor((arenaWidthCells - width) / 2) + anchor.dxCells,
        gridY: Math.floor((arenaHeightCells - height) / 2) + anchor.dyCells,
      };
    case 'grid':
      return { gridX: anchor.gridX, gridY: anchor.gridY };
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

/**
 * Ein authored Respawn-Budget gehoert genau den Zielen, die ueber den Team-Wipe verlieren.
 * Alle anderen Ziele verlieren ueber ihre Basen und duerfen kein Budget fuehren.
 */
export function objectiveUsesRespawnBudget(objective: CoopDefenseMapObjective): boolean {
  return objective === 'survive' || objective === 'advance';
}

function normalizeRespawnsPerPlayer(
  mapId: string,
  objective: CoopDefenseMapObjective,
  value: number | undefined,
): number | undefined {
  if (!objectiveUsesRespawnBudget(objective)) {
    if (value !== undefined) {
      throw new Error(
        `[coopDefenseMaps] Only survive and advance maps may declare respawnsPerPlayer: ${mapId}`,
      );
    }
    return undefined;
  }
  if (value === undefined || !Number.isFinite(value) || value < 0) {
    throw new Error(`[coopDefenseMaps] Invalid respawnsPerPlayer on map ${mapId}: ${value}`);
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
    && objective !== 'advance'
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
  // Der Vorstoss gewinnt ueber die Route und verliert ueber den Team-Wipe: keine Basispflicht.
  if (normalizedObjective === 'advance') return normalizedObjective;
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
      groups: encounter.groups.map((group) => normalizeEncounterGroup(mapId, id, group, context)),
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

    // Hold ist binaer und besitzt keinen Hintergrundzustand: mindestens ein authored Ziel und ein
    // Haltefenster statt eines Fokusfensters. Ohne requiredSurvivors muessen alle Targets leben.
    if (objective.type === 'hold') {
      const hasHoldUntil = objective.holdUntil !== undefined;
      const hasHoldDuration = objective.holdDurationMs !== undefined;
      if (hasHoldUntil === hasHoldDuration) {
        throw new Error(
          `[coopDefenseMaps] Hold secondary objective ${mapId}:${id} needs exactly one of holdUntil or holdDurationMs`,
        );
      }
      if (objective.focusUntil !== undefined) {
        throw new Error(`[coopDefenseMaps] Hold secondary objective ${mapId}:${id} must not declare focusUntil`);
      }
      if (objective.requiredSurvivors !== undefined
        && (!Number.isInteger(objective.requiredSurvivors)
          || objective.requiredSurvivors < 1
          || objective.requiredSurvivors > authoredTargets.length)) {
        throw new Error(
          `[coopDefenseMaps] Hold secondary objective ${mapId}:${id} has invalid requiredSurvivors`,
        );
      }
    } else {
      if (objective.holdUntil !== undefined) {
        throw new Error(`[coopDefenseMaps] Secondary objective ${mapId}:${id} must not declare holdUntil`);
      }
      if (objective.holdDurationMs !== undefined) {
        throw new Error(`[coopDefenseMaps] Secondary objective ${mapId}:${id} must not declare holdDurationMs`);
      }
      if (objective.requiredSurvivors !== undefined) {
        throw new Error(
          `[coopDefenseMaps] Secondary objective ${mapId}:${id} must not declare requiredSurvivors`,
        );
      }
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
      ...(objective.holdDurationMs === undefined
        ? {}
        : { holdDurationMs: normalizePositiveMilliseconds(mapId, id, objective.holdDurationMs, 'holdDurationMs') }),
      ...(objective.requiredSurvivors === undefined
        ? {}
        : { requiredSurvivors: objective.requiredSurvivors }),
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
    case 'after-checkpoint': {
      const checkpointId = normalizeRequiredId(
        trigger.checkpointId,
        `[coopDefenseMaps] Secondary objective ${mapId}:${objectiveId} needs a checkpoint id for ${fieldName}`,
      );
      return { type: 'after-checkpoint', checkpointId };
    }
    case 'after-defense': {
      const defenseId = normalizeRequiredId(
        trigger.defenseId,
        `[coopDefenseMaps] Secondary objective ${mapId}:${objectiveId} needs a defense id for ${fieldName}`,
      );
      return { type: 'after-defense', defenseId };
    }
    default:
      throw new Error(
        `[coopDefenseMaps] Secondary objective ${mapId}:${objectiveId} has unsupported ${fieldName} trigger: ${trigger.type}`,
      );
  }
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
  readonly arenaWidthCells: number;
  readonly arenaHeightCells: number;
  readonly checkpointIds?: ReadonlySet<string>;
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
    case 'after-checkpoint':
      return {
        type: 'after-checkpoint',
        checkpointId: normalizeRequiredId(
          start.checkpointId,
          `[coopDefenseMaps] Encounter ${mapId}:${encounterId} needs a checkpoint id`,
        ),
      };
    case 'after-defense':
      return {
        type: 'after-defense',
        defenseId: normalizeRequiredId(
          start.defenseId,
          `[coopDefenseMaps] Encounter ${mapId}:${encounterId} needs a defense id`,
        ),
      };
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
  context: EncounterTriggerNormalizationContext,
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

  if (group.spawnArea !== undefined && group.front !== undefined) {
    throw new Error(
      `[coopDefenseMaps] Encounter ${mapId}:${encounterId} must not combine front and spawnArea`,
    );
  }
  const spawnArea = normalizeSpawnArea(mapId, encounterId, group.spawnArea, context);

  return {
    enemyKind: group.enemyKind,
    count: Math.floor(group.count),
    delayMs: normalizeNonNegativeMilliseconds(group.delayMs),
    spawnStaggerMs: normalizeNonNegativeMilliseconds(
      group.spawnStaggerMs ?? DEFAULT_COOP_DEFENSE_ENCOUNTER_SPAWN_STAGGER_MS,
    ),
    front: normalizeSpawnFront(mapId, encounterId, group.front),
    ...(spawnArea ? { spawnArea } : {}),
  };
}

function normalizeSpawnArea(
  mapId: string,
  ownerId: string,
  area: CoopDefenseMapSpawnAreaConfig | undefined,
  context: EncounterTriggerNormalizationContext,
): CoopDefenseMapSpawnAreaConfig | undefined {
  if (area === undefined) return undefined;
  const values = [area.gridX, area.gridY, area.widthCells, area.heightCells];
  if (values.some((value) => !Number.isInteger(value))) {
    throw new Error(`[coopDefenseMaps] ${mapId}:${ownerId} has a non-integer spawnArea`);
  }
  if (area.gridX < 0 || area.gridY < 0 || area.widthCells < 1 || area.heightCells < 1
    || area.gridX + area.widthCells > context.arenaWidthCells
    || area.gridY + area.heightCells > context.arenaHeightCells) {
    throw new Error(`[coopDefenseMaps] ${mapId}:${ownerId} has an out-of-bounds spawnArea`);
  }
  return {
    gridX: area.gridX,
    gridY: area.gridY,
    widthCells: area.widthCells,
    heightCells: area.heightCells,
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
  checkpointIds: ReadonlySet<string>,
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
    const start = normalizeMapEventStart(mapId, event.id, event.start, encounters, {
      bases,
      boss,
      arenaWidthCells,
      arenaHeightCells,
      checkpointIds,
    });
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
  if (typeof effect.sourceId !== 'string' || effect.sourceId.trim().length === 0) {
    throw new Error(`[coopDefenseMaps] Ground hazard event ${mapId}:${event.id} needs a sourceId`);
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
      sourceId: effect.sourceId.trim(),
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
  if (start.type === 'after-checkpoint') {
    if (typeof start.checkpointId !== 'string' || start.checkpointId.trim().length === 0) {
      throw new Error(`[coopDefenseMaps] Map event ${mapId}:${eventId} needs a checkpoint id`);
    }
    const checkpointId = start.checkpointId.trim();
    if (!context.checkpointIds?.has(checkpointId)) {
      throw new Error(
        `[coopDefenseMaps] Map event ${mapId}:${eventId} references unknown checkpoint: ${checkpointId}`,
      );
    }
    return { type: 'after-checkpoint', checkpointId };
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
  if (start.type === 'after-event') {
    if (typeof start.eventId !== 'string' || start.eventId.trim().length === 0) {
      throw new Error(`[coopDefenseMaps] Map event ${mapId}:${eventId} needs an event id`);
    }
    return { type: 'after-event', eventId: start.eventId.trim() };
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

type MissionDependencyNode =
  | `encounter:${string}`
  | `event:${string}`
  | `checkpoint:${string}`
  | `defense:${string}`
  | `objective:${string}`;

function validateMissionDependencyGraph(
  mapId: string,
  encounters: readonly ResolvedCoopDefenseMapEncounterConfig[],
  events: readonly ResolvedCoopDefenseMapEventConfig[],
  objectives: readonly CoopDefenseMapSecondaryObjectiveConfig[],
  mission: ResolvedCoopDefenseMapMissionProgressConfig | undefined,
): void {
  const encounterIds = new Set(encounters.map((encounter) => encounter.id));
  const eventById = new Map(events.map((event) => [event.id, event]));
  const checkpointIds = new Set(mission?.checkpoints.map((checkpoint) => checkpoint.id) ?? []);
  const defenseById = new Map(mission?.mandatoryDefenses.map((defense) => [defense.id, defense]) ?? []);
  const adjacency = new Map<MissionDependencyNode, MissionDependencyNode[]>();
  const addNode = (node: MissionDependencyNode): void => {
    if (!adjacency.has(node)) adjacency.set(node, []);
  };
  const addDependency = (source: MissionDependencyNode, dependent: MissionDependencyNode): void => {
    addNode(source);
    addNode(dependent);
    adjacency.get(source)!.push(dependent);
  };

  const validateMissionTrigger = (
    owner: string,
    trigger: CoopDefenseMapEncounterStart,
  ): void => {
    if (trigger.type === 'after-checkpoint' && !checkpointIds.has(trigger.checkpointId)) {
      throw new Error(`[coopDefenseMaps] ${owner} on map ${mapId} references unknown checkpoint: ${trigger.checkpointId}`);
    }
    if (trigger.type === 'after-defense' && !defenseById.has(trigger.defenseId)) {
      throw new Error(`[coopDefenseMaps] ${owner} on map ${mapId} references unknown defense: ${trigger.defenseId}`);
    }
  };

  const addMissionTriggerDependency = (
    owner: MissionDependencyNode,
    ownerLabel: string,
    trigger: CoopDefenseMapEncounterStart,
  ): void => {
    validateMissionTrigger(ownerLabel, trigger);
    if (trigger.type === 'after-checkpoint') {
      addDependency(`checkpoint:${trigger.checkpointId}`, owner);
    } else if (trigger.type === 'after-defense') {
      addDependency(`defense:${trigger.defenseId}`, owner);
    } else if (trigger.type === 'after-encounter') {
      if (!encounterIds.has(trigger.encounterId)) {
        throw new Error(
          `[coopDefenseMaps] ${ownerLabel} on map ${mapId} references unknown encounter: ${trigger.encounterId}`,
        );
      }
      addDependency(`encounter:${trigger.encounterId}`, owner);
    }
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
    } else if (encounter.start.type === 'after-checkpoint' || encounter.start.type === 'after-defense') {
      addMissionTriggerDependency(dependent, `Encounter ${encounter.id}`, encounter.start);
    }
  }

  for (const event of events) {
    const dependent = `event:${event.id}` as const;
    addNode(dependent);
    if (event.start.type === 'after-checkpoint') {
      if (!checkpointIds.has(event.start.checkpointId)) {
        throw new Error(
          `[coopDefenseMaps] Map event ${mapId}:${event.id} references unknown checkpoint: ${event.start.checkpointId}`,
        );
      }
      addDependency(`checkpoint:${event.start.checkpointId}`, dependent);
      continue;
    }
    if (event.start.type === 'after-encounter') {
      if (!encounterIds.has(event.start.encounterId)) {
        throw new Error(
          `[coopDefenseMaps] Map event ${mapId}:${event.id} references unknown encounter: ${event.start.encounterId}`,
        );
      }
      addDependency(`encounter:${event.start.encounterId}`, dependent);
      continue;
    }
    if (event.start.type === 'after-event') {
      const source = eventById.get(event.start.eventId);
      if (!source) {
        throw new Error(
          `[coopDefenseMaps] Map event ${mapId}:${event.id} references unknown map event: ${event.start.eventId}`,
        );
      }
      if (!isFiniteMapEvent(source)) {
        throw new Error(
          `[coopDefenseMaps] Map event ${mapId}:${event.id} cannot wait for repeatable or persistent event: ${source.id}`,
        );
      }
      addDependency(`event:${source.id}`, dependent);
    }
  }

  for (const checkpoint of mission?.checkpoints ?? []) {
    addNode(`checkpoint:${checkpoint.id}`);
  }
  for (const defense of mission?.mandatoryDefenses ?? []) {
    const defenseNode = `defense:${defense.id}` as const;
    addDependency(`checkpoint:${defense.checkpointId}`, defenseNode);
    addDependency(`objective:${defense.objectiveId}`, defenseNode);
  }

  for (const objective of objectives) {
    const objectiveNode = `objective:${objective.id}` as const;
    addNode(objectiveNode);
    addMissionTriggerDependency(objectiveNode, `Secondary objective ${objective.id}`, objective.start);
    if (objective.focusUntil) {
      addMissionTriggerDependency(objectiveNode, `Secondary objective ${objective.id}`, objective.focusUntil);
    }
    if (objective.holdUntil) {
      addMissionTriggerDependency(objectiveNode, `Secondary objective ${objective.id}`, objective.holdUntil);
    }
  }

  const visiting = new Set<MissionDependencyNode>();
  const visited = new Set<MissionDependencyNode>();
  const path: MissionDependencyNode[] = [];
  const visit = (node: MissionDependencyNode): void => {
    if (visiting.has(node)) {
      const cycleStart = path.indexOf(node);
      const cycle = [...path.slice(cycleStart), node].join(' -> ');
      throw new Error(`[coopDefenseMaps] Map ${mapId} has cyclic mission dependency: ${cycle}`);
    }
    if (visited.has(node)) return;
    visiting.add(node);
    path.push(node);
    for (const dependent of adjacency.get(node) ?? []) visit(dependent);
    path.pop();
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

function normalizeDynamicTimeOfDayConfig(
  mapId: string,
  config: CoopDefenseDynamicTimeOfDayConfig | undefined,
  boss: CoopDefenseMapBossConfig | undefined,
): CoopDefenseDynamicTimeOfDayConfig | undefined {
  if (config === undefined) return undefined;

  const minutesPerSecond = config.minutesPerSecond;
  if (minutesPerSecond !== undefined && (!Number.isFinite(minutesPerSecond) || minutesPerSecond < 0)) {
    throw new Error(`[coopDefenseMaps] Invalid dynamic time rate in map ${mapId}`);
  }

  const transitions = (config.transitions ?? []).map((transition, index) => {
    const targetMinutes = parseTimeOfDay(transition.targetTimeOfDay);
    if (targetMinutes === null) {
      throw new Error(
        `[coopDefenseMaps] Invalid dynamic time target in map ${mapId} transition ${index}: ${transition.targetTimeOfDay}`,
      );
    }
    if (!Number.isFinite(transition.durationMs) || transition.durationMs < 0) {
      throw new Error(`[coopDefenseMaps] Dynamic time transition ${index} in map ${mapId} needs a non-negative durationMs`);
    }

    const start = transition.start;
    let normalizedStart: CoopDefenseTimeOfDayTransitionStart;
    if (start.type === 'time') {
      if (!Number.isFinite(start.atMs) || start.atMs < 0) {
        throw new Error(`[coopDefenseMaps] Dynamic time transition ${index} in map ${mapId} needs a non-negative atMs`);
      }
      normalizedStart = { type: 'time', atMs: Math.floor(start.atMs) };
    } else if (start.type === 'boss-spawn') {
      if (!boss) {
        throw new Error(`[coopDefenseMaps] Dynamic time transition ${index} in map ${mapId} needs a boss`);
      }
      normalizedStart = { type: 'boss-spawn' };
    } else if (start.type === 'boss-phase') {
      if (!boss || !Number.isInteger(start.phase) || start.phase < 1) {
        throw new Error(`[coopDefenseMaps] Invalid boss phase time transition ${index} in map ${mapId}`);
      }
      if (transition.durationMs !== 0) {
        throw new Error(
          `[coopDefenseMaps] Boss phase time transition ${index} in map ${mapId} must be instantaneous`,
        );
      }
      normalizedStart = { type: 'boss-phase', phase: start.phase };
    } else {
      throw new Error(`[coopDefenseMaps] Unsupported dynamic time transition ${index} in map ${mapId}`);
    }

    return {
      start: normalizedStart,
      targetTimeOfDay: formatTimeOfDay(targetMinutes),
      durationMs: Math.floor(transition.durationMs),
    };
  });

  if (minutesPerSecond === undefined && transitions.length === 0) {
    throw new Error(`[coopDefenseMaps] Dynamic time config in map ${mapId} is empty`);
  }

  const firstBossPhaseIndex = transitions.findIndex((transition) => transition.start.type === 'boss-phase');
  if (firstBossPhaseIndex >= 0) {
    const bossPhases = transitions.slice(firstBossPhaseIndex);
    if (bossPhases.some((transition) => transition.start.type !== 'boss-phase')) {
      throw new Error(`[coopDefenseMaps] Boss phase time transitions in map ${mapId} must come last`);
    }
    const phaseNumbers = bossPhases.map((transition) => (
      transition.start.type === 'boss-phase' ? transition.start.phase : 0
    ));
    if (phaseNumbers.some((phase, index) => index > 0 && phase <= phaseNumbers[index - 1])) {
      throw new Error(`[coopDefenseMaps] Boss phase time transitions in map ${mapId} must be ascending`);
    }
  }

  return {
    minutesPerSecond,
    transitions: transitions.length > 0 ? transitions : undefined,
  };
}

function normalizeMissionProgressConfig(
  mapId: string,
  config: CoopDefenseMapMissionProgressConfig | ResolvedCoopDefenseMapMissionProgressConfig | undefined,
  arenaWidthCells: number,
  arenaHeightCells: number,
  encounters: readonly CoopDefenseMapEncounterConfig[],
  objectives: readonly CoopDefenseMapSecondaryObjectiveConfig[],
): ResolvedCoopDefenseMapMissionProgressConfig | undefined {
  if (config === undefined) return undefined;
  if (!Array.isArray(config.checkpoints) || config.checkpoints.length === 0) {
    throw new Error(`[coopDefenseMaps] Mission progress ${mapId} needs at least one checkpoint`);
  }

  const checkpointIds = new Set<string>();
  const checkpoints = config.checkpoints.map((checkpoint) => {
    const id = normalizeRequiredId(
      checkpoint.id,
      `[coopDefenseMaps] Mission progress ${mapId} checkpoint needs a non-empty id`,
    );
    if (checkpointIds.has(id)) {
      throw new Error(`[coopDefenseMaps] Duplicate mission checkpoint id on map ${mapId}: ${id}`);
    }
    checkpointIds.add(id);
    if (!Number.isInteger(checkpoint.gridX) || !Number.isInteger(checkpoint.gridY)
      || checkpoint.gridX < 0 || checkpoint.gridX >= arenaWidthCells
      || checkpoint.gridY < 0 || checkpoint.gridY >= arenaHeightCells) {
      throw new Error(`[coopDefenseMaps] Mission checkpoint ${mapId}:${id} is outside the arena`);
    }
    const radiusCells = checkpoint.radiusCells ?? 1;
    if (typeof radiusCells !== 'number' || !Number.isFinite(radiusCells) || radiusCells <= 0) {
      throw new Error(`[coopDefenseMaps] Mission checkpoint ${mapId}:${id} needs a positive radiusCells`);
    }
    return {
      id,
      gridX: checkpoint.gridX,
      gridY: checkpoint.gridY,
      radiusCells,
      setRespawn: checkpoint.setRespawn === true,
    };
  });

  const defenseIds = new Set<string>();
  const mandatoryDefenses = (config.mandatoryDefenses ?? []).map((defense) => {
    const id = normalizeRequiredId(
      defense.id,
      `[coopDefenseMaps] Mandatory defense on map ${mapId} needs a non-empty id`,
    );
    if (defenseIds.has(id)) {
      throw new Error(`[coopDefenseMaps] Duplicate mandatory defense id on map ${mapId}: ${id}`);
    }
    defenseIds.add(id);
    const checkpointId = normalizeRequiredId(
      defense.checkpointId,
      `[coopDefenseMaps] Mandatory defense ${mapId}:${id} needs a checkpointId`,
    );
    const objectiveId = normalizeRequiredId(
      defense.objectiveId,
      `[coopDefenseMaps] Mandatory defense ${mapId}:${id} needs an objectiveId`,
    );
    if (!checkpointIds.has(checkpointId)) {
      throw new Error(`[coopDefenseMaps] Mandatory defense ${mapId}:${id} references unknown checkpoint: ${checkpointId}`);
    }
    const objective = objectives.find((candidate) => candidate.id === objectiveId);
    if (!objective || objective.type !== 'hold') {
      throw new Error(`[coopDefenseMaps] Mandatory defense ${mapId}:${id} must reference a hold objective: ${objectiveId}`);
    }
    if (objective.start.type !== 'after-checkpoint' || objective.start.checkpointId !== checkpointId) {
      throw new Error(
        `[coopDefenseMaps] Mandatory defense ${mapId}:${id} hold ${objectiveId} must start after checkpoint ${checkpointId}`,
      );
    }
    return { id, checkpointId, objectiveId, failureEndsMission: defense.failureEndsMission === true };
  });

  const barrierIds = new Set<string>();
  const reservedCells = new Set<string>();
  const barriers = (config.barriers ?? []).map((barrier) => {
    const id = normalizeRequiredId(
      barrier.id,
      `[coopDefenseMaps] Mission barrier on map ${mapId} needs a non-empty id`,
    );
    if (barrierIds.has(id)) {
      throw new Error(`[coopDefenseMaps] Duplicate mission barrier id on map ${mapId}: ${id}`);
    }
    barrierIds.add(id);
    if (!Array.isArray(barrier.cells) || barrier.cells.length === 0) {
      throw new Error(`[coopDefenseMaps] Mission barrier ${mapId}:${id} needs at least one cell`);
    }
    const cells = barrier.cells.map((cell) => {
      if (!Number.isInteger(cell.gridX) || !Number.isInteger(cell.gridY)
        || cell.gridX < 0 || cell.gridX >= arenaWidthCells
        || cell.gridY < 0 || cell.gridY >= arenaHeightCells) {
        throw new Error(`[coopDefenseMaps] Mission barrier ${mapId}:${id} has an out-of-bounds cell`);
      }
      const key = `${cell.gridX},${cell.gridY}`;
      if (reservedCells.has(key)) {
        throw new Error(`[coopDefenseMaps] Mission barrier cell ${mapId}:${key} is reserved more than once`);
      }
      reservedCells.add(key);
      return { gridX: cell.gridX, gridY: cell.gridY };
    });
    const openOn = normalizeMissionBarrierTrigger(mapId, id, barrier.openOn, checkpointIds, defenseIds, encounters);
    return { id, cells, openOn };
  });

  const startArea = normalizeMissionStartArea(
    mapId,
    config.startArea,
    arenaWidthCells,
    arenaHeightCells,
  );

  return { checkpoints, barriers, mandatoryDefenses, ...(startArea ? { startArea } : {}) };
}

function normalizeRockWallConfigs(
  mapId: string,
  rockWalls: readonly CoopDefenseMapRockWallConfig[] | undefined,
  arenaWidthCells: number,
  arenaHeightCells: number,
  missionProgress: ResolvedCoopDefenseMapMissionProgressConfig | undefined,
): readonly CoopDefenseMapRockWallConfig[] | undefined {
  if (rockWalls === undefined) return undefined;
  if (!Array.isArray(rockWalls)) {
    throw new Error(`[coopDefenseMaps] Rock walls on map ${mapId} must be an array`);
  }
  const barrierCells = new Set(
    (missionProgress?.barriers ?? []).flatMap((barrier) => (
      barrier.cells.map((cell) => `${cell.gridX},${cell.gridY}`)
    )),
  );
  const wallIds = new Set<string>();
  return rockWalls.map((wall) => {
    const id = normalizeRequiredId(
      wall.id,
      `[coopDefenseMaps] Rock wall on map ${mapId} needs a non-empty id`,
    );
    if (wallIds.has(id)) {
      throw new Error(`[coopDefenseMaps] Duplicate rock wall id on map ${mapId}: ${id}`);
    }
    wallIds.add(id);
    const values = [wall.gridX, wall.gridY, wall.widthCells, wall.heightCells];
    if (values.some((value) => !Number.isInteger(value))) {
      throw new Error(`[coopDefenseMaps] Rock wall ${mapId}:${id} has a non-integer bound`);
    }
    if (wall.gridX < 0 || wall.gridY < 0 || wall.widthCells < 1 || wall.heightCells < 1
      || wall.gridX + wall.widthCells > arenaWidthCells
      || wall.gridY + wall.heightCells > arenaHeightCells) {
      throw new Error(`[coopDefenseMaps] Rock wall ${mapId}:${id} is outside the arena`);
    }
    for (let gridY = wall.gridY; gridY < wall.gridY + wall.heightCells; gridY += 1) {
      for (let gridX = wall.gridX; gridX < wall.gridX + wall.widthCells; gridX += 1) {
        if (barrierCells.has(`${gridX},${gridY}`)) {
          throw new Error(
            `[coopDefenseMaps] Rock wall ${mapId}:${id} overlaps a reserved mission barrier cell`,
          );
        }
      }
    }
    return {
      id,
      gridX: wall.gridX,
      gridY: wall.gridY,
      widthCells: wall.widthCells,
      heightCells: wall.heightCells,
    };
  });
}

function normalizeTutorialAnchor(
  mapId: string,
  anchor: CoopDefenseMapTutorialAnchorConfig | undefined,
  arenaWidthCells: number,
  arenaHeightCells: number,
): CoopDefenseMapTutorialAnchorConfig | undefined {
  if (anchor === undefined) return undefined;
  if (!Number.isInteger(anchor.gridX) || !Number.isInteger(anchor.gridY)
    || anchor.gridX < 0 || anchor.gridX >= arenaWidthCells
    || anchor.gridY < 0 || anchor.gridY >= arenaHeightCells) {
    throw new Error(`[coopDefenseMaps] Tutorial anchor on map ${mapId} is outside the arena`);
  }
  return { gridX: anchor.gridX, gridY: anchor.gridY };
}

function normalizeTutorialSteps(
  mapId: string,
  steps: readonly CoopDefenseMapTutorialStepConfig[] | undefined,
  missionProgress: ResolvedCoopDefenseMapMissionProgressConfig | undefined,
  arenaWidthCells: number,
  arenaHeightCells: number,
): readonly ResolvedCoopDefenseMapTutorialStepConfig[] | undefined {
  if (steps === undefined) return undefined;
  if (!Array.isArray(steps)) {
    throw new Error(`[coopDefenseMaps] Tutorial steps on map ${mapId} must be an array`);
  }
  const checkpointIds = new Set((missionProgress?.checkpoints ?? []).map((checkpoint) => checkpoint.id));
  const stepIds = new Set<string>();
  return steps.map((step) => {
    const id = normalizeRequiredId(
      step.id,
      `[coopDefenseMaps] Tutorial step on map ${mapId} needs a non-empty id`,
    );
    if (stepIds.has(id)) {
      throw new Error(`[coopDefenseMaps] Duplicate tutorial step id on map ${mapId}: ${id}`);
    }
    stepIds.add(id);
    const checkpointId = normalizeRequiredId(
      step.checkpointId,
      `[coopDefenseMaps] Tutorial step ${mapId}:${id} needs a checkpointId`,
    );
    if (!checkpointIds.has(checkpointId)) {
      throw new Error(`[coopDefenseMaps] Tutorial step ${mapId}:${id} references unknown checkpoint: ${checkpointId}`);
    }
    const durationMs = step.durationMs ?? COOP_DEFENSE_TUTORIAL_STEP_DEFAULT_DURATION_MS;
    if (typeof durationMs !== 'number' || !Number.isFinite(durationMs) || durationMs <= 0) {
      throw new Error(`[coopDefenseMaps] Tutorial step ${mapId}:${id} needs a positive durationMs`);
    }
    const anchor = normalizeTutorialAnchor(
      mapId,
      step.anchor,
      arenaWidthCells,
      arenaHeightCells,
    );
    return {
      id,
      checkpointId,
      ...(anchor ? { anchor } : {}),
      durationMs: Math.floor(durationMs),
    };
  });
}

function normalizeMissionStartArea(
  mapId: string,
  startArea: CoopDefenseMapMissionStartAreaConfig | undefined,
  arenaWidthCells: number,
  arenaHeightCells: number,
): ResolvedCoopDefenseMapMissionStartAreaConfig | undefined {
  if (startArea === undefined) return undefined;
  if (!Number.isInteger(startArea.gridX) || !Number.isInteger(startArea.gridY)
    || startArea.gridX < 0 || startArea.gridX >= arenaWidthCells
    || startArea.gridY < 0 || startArea.gridY >= arenaHeightCells) {
    throw new Error(`[coopDefenseMaps] Mission start area on map ${mapId} is outside the arena`);
  }
  const radiusCells = startArea.radiusCells ?? 4;
  if (typeof radiusCells !== 'number' || !Number.isFinite(radiusCells) || radiusCells <= 0) {
    throw new Error(`[coopDefenseMaps] Mission start area on map ${mapId} needs a positive radiusCells`);
  }
  return { gridX: startArea.gridX, gridY: startArea.gridY, radiusCells };
}

function normalizeMissionBarrierTrigger(
  mapId: string,
  barrierId: string,
  trigger: CoopDefenseMapMissionBarrierOpenTrigger,
  checkpointIds: ReadonlySet<string>,
  defenseIds: ReadonlySet<string>,
  encounters: readonly CoopDefenseMapEncounterConfig[],
): CoopDefenseMapMissionBarrierOpenTrigger {
  if (!trigger || typeof trigger.type !== 'string') {
    throw new Error(`[coopDefenseMaps] Mission barrier ${mapId}:${barrierId} needs an openOn trigger`);
  }
  if (trigger.type === 'after-checkpoint') {
    const checkpointId = normalizeRequiredId(trigger.checkpointId, `[coopDefenseMaps] Barrier ${mapId}:${barrierId} needs checkpointId`);
    if (!checkpointIds.has(checkpointId)) throw new Error(`[coopDefenseMaps] Barrier ${mapId}:${barrierId} references unknown checkpoint: ${checkpointId}`);
    return { type: 'after-checkpoint', checkpointId };
  }
  if (trigger.type === 'after-defense') {
    const defenseId = normalizeRequiredId(trigger.defenseId, `[coopDefenseMaps] Barrier ${mapId}:${barrierId} needs defenseId`);
    if (!defenseIds.has(defenseId)) throw new Error(`[coopDefenseMaps] Barrier ${mapId}:${barrierId} references unknown defense: ${defenseId}`);
    return { type: 'after-defense', defenseId };
  }
  if (trigger.type === 'after-encounter') {
    const encounterId = normalizeRequiredId(trigger.encounterId, `[coopDefenseMaps] Barrier ${mapId}:${barrierId} needs encounterId`);
    if (!encounters.some((encounter) => encounter.id === encounterId)) {
      throw new Error(`[coopDefenseMaps] Barrier ${mapId}:${barrierId} references unknown encounter: ${encounterId}`);
    }
    return { type: 'after-encounter', encounterId };
  }
  throw new Error(`[coopDefenseMaps] Mission barrier ${mapId}:${barrierId} has unsupported openOn trigger`);
}

function normalizeRequiredId(value: unknown, message: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(message);
  return value.trim();
}

function normalizePositiveMilliseconds(mapId: string, ownerId: string, value: number, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error(`[coopDefenseMaps] ${mapId}:${ownerId} needs a positive ${label}`);
  }
  return Math.max(1, Math.floor(value));
}

function normalizeTrackPosition(
  mapId: string,
  trackPosition: CoopDefenseMapTrackPosition | undefined,
  arenaWidthCells: number,
): CoopDefenseMapTrackPosition {
  if (trackPosition === undefined) return 'center';
  if (trackPosition === 'left' || trackPosition === 'center' || trackPosition === 'right') {
    return trackPosition;
  }
  if (
    trackPosition?.kind !== 'grid'
    || !Number.isFinite(trackPosition.gridX)
    || !Number.isInteger(trackPosition.gridX)
    || trackPosition.gridX < 0
    || trackPosition.gridX >= arenaWidthCells - 1
  ) {
    throw new Error(
      `[coopDefenseMaps] Invalid trackPosition on map ${mapId}; expected left, center, right or a gridX within the two-column arena footprint`,
    );
  }
  return {
    kind: 'grid',
    gridX: trackPosition.gridX,
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

function normalizeTreeCount(treeCount: number | undefined): number | undefined {
  if (treeCount === undefined || !Number.isFinite(treeCount)) return undefined;
  return Math.max(0, Math.floor(treeCount));
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
    turret.weaponId !== 'SPORES'
    && turret.weaponId !== 'BASE_SPORES'
    && turret.weaponId !== 'SPORE_TURRET_PLASMA'
    && turret.weaponId !== 'TURRET_ROCKET_BURST'
    && turret.weaponId !== 'TURRET_MG'
    && turret.weaponId !== 'TURRET_FLAME'
    && turret.weaponId !== 'TURRET_VOID_FLAME'
    && turret.weaponId !== 'TURRET_SPORES'
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
