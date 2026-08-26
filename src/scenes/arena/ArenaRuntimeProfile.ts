/**
 * Runtime-Profil-Vertrag des ArenaWorld-Cores.
 *
 * Der Core (Layout, Rendering, Placement, Player-Runtime) ist für beide Laufzeiten identisch.
 * Alles, was ausschließlich zur Mission gehört, hängt an genau einem Flag dieses Profils –
 * damit gibt es keine verstreuten `if (editorRuntime)`-Sonderfälle im Lifecycle.
 */
export type ArenaRuntimeKind = 'mission' | 'persistent-base-editor';

export interface ArenaRuntimeProfile {
  readonly kind: ArenaRuntimeKind;
  /** Gegner-Entities, Spawns, Encounter, Boss und die dazugehörigen Flowfields/AI-Systeme. */
  readonly enemies: boolean;
  /** Hauptziel, Nebenziele, Missionsfortschritt und Missionsbarrieren. */
  readonly objectives: boolean;
  /** Sieg/Niederlage, Respawn-Budget und Rundenauswertung. */
  readonly roundConclusion: boolean;
  /** Power-Ups, Pedestals, Zug- und Map-Events. */
  readonly worldEvents: boolean;
  /** Feindliche Kampfsimulation gegen Spieler (Schaden, Hazards, Airstrikes, Armageddon). */
  readonly combatSimulation: boolean;
  /** Arena-Ladebarriere, Countdown, Rundentimer und Rundenteilnahme. */
  readonly roundLifecycle: boolean;
  /** Missionsgebundene Persistent-Base-Buchführung (Session, Room-State, Commit/Rollback). */
  readonly missionPersistentBaseSession: boolean;
}

export const MISSION_RUNTIME_PROFILE: ArenaRuntimeProfile = {
  kind: 'mission',
  enemies: true,
  objectives: true,
  roundConclusion: true,
  worldEvents: true,
  combatSimulation: true,
  roundLifecycle: true,
  missionPersistentBaseSession: true,
};

/**
 * Der Editor braucht nur World/Rendering, Spielerbewegung, Placement, Move/Dismantle und die
 * Persistent-Base-Runtime. Jedes Missionsflag ist bewusst aus.
 */
export const PERSISTENT_BASE_EDITOR_RUNTIME_PROFILE: ArenaRuntimeProfile = {
  kind: 'persistent-base-editor',
  enemies: false,
  objectives: false,
  roundConclusion: false,
  worldEvents: false,
  combatSimulation: false,
  roundLifecycle: false,
  missionPersistentBaseSession: false,
};

export function getArenaRuntimeProfile(kind: ArenaRuntimeKind): ArenaRuntimeProfile {
  return kind === 'persistent-base-editor'
    ? PERSISTENT_BASE_EDITOR_RUNTIME_PROFILE
    : MISSION_RUNTIME_PROFILE;
}
