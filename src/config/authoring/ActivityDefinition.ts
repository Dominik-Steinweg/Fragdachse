import type {
  CoopBasePlayerScaling,
  CoopBasePowerUpPedestalConfig,
  CoopDefenseDynamicTimeOfDayConfig,
  CoopDefenseMapBossConfig,
  CoopDefenseMapEncounterConfig,
  CoopDefenseMapEventConfig,
  CoopDefenseMapItemDropConfig,
  CoopDefenseMapObjective,
  CoopDefenseMapPersistentSpawnConfig,
  CoopDefenseMapPowerUpConfig,
  CoopDefenseMapSecondaryObjectiveConfig,
  CoopDefenseMapTutorialAnchorConfig,
  ResolvedCoopDefenseMapMissionProgressConfig,
  ResolvedCoopDefenseMapTutorialStepConfig,
} from '../coopDefenseMaps';

/**
 * Authoring-Vertrag einer Activity.
 *
 * Eine Activity beschreibt ausschliesslich Gameplay *innerhalb* einer
 * {@link import('./WorldDefinition').WorldDefinition}: Ziel, Ausgang, Druck, Belohnung und
 * alles, was ohne laufende Activity schlicht nicht existiert. Sie enthaelt keine Weltgeometrie.
 *
 * Eine World kann ohne Activity bestehen. Umgekehrt gilt das nicht: jede Activity nennt ueber
 * {@link CoopMissionDefinition.worldDefinitionId} genau eine World, in der sie stattfindet.
 */
export type ActivityDefinition = CoopMissionDefinition;

/**
 * Kanonisches Vokabular aller Activity-Arten – die einzige Quelle sowohl fuer authored
 * Definitionen als auch fuer den replizierten `ActivityDescriptor`.
 *
 * Nur `coop-mission` besitzt heute eine eigene {@link ActivityDefinition}; die PvP-Modi sind
 * bislang rein durch ihren Modus beschrieben. Die Arten stehen trotzdem hier, damit World- und
 * Activity-Schicht nicht mit zwei verschiedenen Aufzaehlungen arbeiten.
 */
export type ActivityKind =
  | 'coop-mission'
  | 'deathmatch'
  | 'team-deathmatch'
  | 'capture-the-beer';

export interface CoopMissionDefinition {
  readonly kind: 'coop-mission';
  /** Stabile Activity-Identitaet, z. B. `activity:coop-mission:7`. */
  readonly id: string;
  /** Die World, in der diese Mission stattfindet. */
  readonly worldDefinitionId: string;
  /** Map-ID, aus der diese Activity waehrend der Uebergangsphase adaptiert wurde. */
  readonly sourceMapId?: string;

  // ── Ziel und Ausgang ──────────────────────────────────────────────────────
  readonly objective: CoopDefenseMapObjective;
  /** Echte Rundendauer; nur fuer `survive` gesetzt und siegrelevant. */
  readonly surviveDurationSec?: number;
  /** Reine Balancing-Referenz fuer Druck-/Drop-Normalisierung. */
  readonly balanceReferenceDurationSec: number;
  readonly respawnsPerPlayer?: number;

  // ── Druck und Verlauf ─────────────────────────────────────────────────────
  readonly encounters?: readonly CoopDefenseMapEncounterConfig[];
  readonly persistentSpawns?: readonly CoopDefenseMapPersistentSpawnConfig[];
  readonly mapEvents?: readonly CoopDefenseMapEventConfig[];
  readonly secondaryObjectives?: readonly CoopDefenseMapSecondaryObjectiveConfig[];
  readonly missionProgress?: ResolvedCoopDefenseMapMissionProgressConfig;
  readonly boss?: CoopDefenseMapBossConfig;
  /**
   * Missionsabhaengige Anteile der Weltstrukturen, adressiert ueber ihre Basis-ID. Die Struktur
   * selbst steht in der World; hier steht nur, was dieser Durchlauf aus ihr macht.
   */
  readonly baseOverlays?: readonly CoopMissionBaseOverlay[];

  // ── Belohnung und Nachschub ───────────────────────────────────────────────
  readonly powerUps: readonly CoopDefenseMapPowerUpConfig[];
  readonly itemDrop?: CoopDefenseMapItemDropConfig;

  /**
   * Activity-getriggerte Weltveraenderung: der Uhrverlauf laeuft gegen den Rundenstart und
   * kann an Bossphasen haengen. Der statische Startwert bleibt deshalb in der World.
   */
  readonly dynamicTimeOfDay?: CoopDefenseDynamicTimeOfDayConfig;
  /** Onboarding dieser Mission; eine World ohne Activity hat kein Tutorial. */
  readonly tutorial?: CoopMissionTutorialDefinition;
}

/**
 * Was eine laufende Mission aus einer Weltstruktur macht.
 *
 * Jedes Feld hier haengt an einem Durchlauf und nicht am Bauwerk: `startHpFactor` ist ein
 * angeschlagener Rundenstart, `playerScaling` haengt an der Spielerzahl der Runde, `dormant`
 * beschreibt ein Missionsziel, das erst durch seinen Objective-Fortschritt erwacht, und
 * Power-up-Podeste sind mit `respawnMs` und `spawnOnArenaStart` Spawn-Regeln – dieselbe
 * Begruendung wie fuer {@link CoopMissionDefinition.powerUps}.
 */
export interface CoopMissionBaseOverlay {
  /** Verweist auf {@link import('./WorldDefinition').WorldBaseDefinition.id} derselben World. */
  readonly baseId: string;
  readonly startHpFactor?: number;
  readonly playerScaling?: CoopBasePlayerScaling;
  readonly dormant?: boolean;
  readonly powerUpPedestals?: readonly CoopBasePowerUpPedestalConfig[];
}

export interface CoopMissionTutorialDefinition {
  readonly durationMs?: number;
  readonly persistent: boolean;
  readonly showControls: boolean;
  readonly anchor?: CoopDefenseMapTutorialAnchorConfig;
  readonly steps?: readonly ResolvedCoopDefenseMapTutorialStepConfig[];
}
