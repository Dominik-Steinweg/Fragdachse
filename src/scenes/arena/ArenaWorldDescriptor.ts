import type { ArenaDescriptor, PersistentBaseEditorWorld } from '../../types';
import type { ArenaRuntimeKind } from './ArenaRuntimeProfile';

/**
 * Gemeinsamer, generischer Weltvertrag des ArenaWorld-Cores.
 *
 * `buildArena()` kennt nur noch diesen Descriptor. Die Mission speist ihn aus dem replizierten
 * {@link ArenaDescriptor}, der Editor aus seinem eigenen, getrennten Welt-Snapshot. Dadurch kann
 * kein Editor-Zustand in die Mission-/Lobby-Auflösung des `ArenaDescriptor` lecken.
 */
export interface ArenaWorldDescriptor {
  readonly runtimeKind: ArenaRuntimeKind;
  /** Identität der Welt; für die Mission die Rundenrevision, für den Editor die Welt-Revision. */
  readonly revision: number;
  readonly gameMode: ArenaDescriptor['gameMode'];
  readonly mapId: string | null;
  readonly seed: number;
  readonly arenaGeneratorVersion: number;
  readonly layoutFingerprint: string;
  readonly persistentBaseRadiusCells?: number;
}

export function toMissionWorldDescriptor(descriptor: ArenaDescriptor): ArenaWorldDescriptor {
  return {
    runtimeKind: 'mission',
    revision: descriptor.roundRevision,
    gameMode: descriptor.gameMode,
    mapId: descriptor.mapId,
    seed: descriptor.seed,
    arenaGeneratorVersion: descriptor.arenaGeneratorVersion,
    layoutFingerprint: descriptor.layoutFingerprint,
  };
}

export function toPersistentBaseEditorWorldDescriptor(
  world: PersistentBaseEditorWorld,
): ArenaWorldDescriptor {
  return {
    runtimeKind: 'persistent-base-editor',
    revision: world.revision,
    gameMode: world.gameMode,
    // Die Editor-Welt ist keine Kampagnenkarte; ihre Identität ist das Runtime-Profil selbst.
    mapId: null,
    seed: world.seed,
    arenaGeneratorVersion: world.arenaGeneratorVersion,
    layoutFingerprint: world.layoutFingerprint,
    persistentBaseRadiusCells: world.radiusCells,
  };
}
