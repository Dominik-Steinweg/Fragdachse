import type {
  ArenaInputDebugHotkey,
  ArenaInputPersistentBasePorts,
  ArenaInputPlacementPorts,
} from './ArenaInputBindings';
import type {
  ConstructionRpcPort,
  HeldActionRpcPort,
  PersistentBaseRpcPort,
  PlayerCapabilitiesRpcPort,
  PlayerLoadoutRpcPort,
  TrainRpcPort,
  WorldParticipationRpcPort,
} from './ArenaRpcPorts';
import type { EnemyVisualSource } from '../../entities/EnemyVisualSource';
import type {
  ArenaDiagnosticsFlowFieldPort,
  ArenaDiagnosticsRockVisualSystemPort,
} from './ArenaDiagnosticsController';
import type { ChunkRenderingDiagnosticsState } from '../../ui/PerformanceDiagnosticsOverlay';
import type { ChunkSamplingMode } from '../../arena/chunks/ChunkedRenderSurface';
import type {
  RockGpuPageSize,
  RockRendererMode,
} from '../../arena/rocks/RockRendererSettings';
import type {
  SyncedAk47StrategicTarget,
  SyncedBurningGroundSnapshot,
  SyncedPowerUpPedestal,
} from '../../types';
import type { WorldClientPresentationState } from '../../world/WorldPresentationFrameBinding';

export interface EnemyFlowFieldDebugPort {
  readonly getCellSize: () => number;
  readonly getCols: () => number;
  readonly getRows: () => number;
  readonly getVectorAt: (gridX: number, gridY: number) => { x: number; y: number };
  readonly getIntegrationValueAt: (gridX: number, gridY: number) => number;
  readonly isTraversableAt: (gridX: number, gridY: number) => boolean;
  readonly gridToWorld: (gridX: number, gridY: number) => { x: number; y: number } | null;
  readonly getGoalCells: () => readonly { gridX: number; gridY: number }[];
  readonly setRefreshListener: (listener: (() => void) | null) => void;
}

export interface ArenaRuntimePresentationPort {
  readonly syncWorldCamera: (deltaMs: number, showWorld: boolean) => void;
  readonly syncWorldSurfaceResidency: (showWorld: boolean) => void;
  readonly syncWorldClientPresentation: (
    state: WorldClientPresentationState | undefined,
    delta: number,
    countdownActive: boolean,
    countdownGround: SyncedBurningGroundSnapshot,
    countdownPedestals: SyncedPowerUpPedestal[],
  ) => void;
  readonly syncWorldCanopy: (showWorld: boolean) => void;
  readonly syncCoopMissionPresentation: (deltaMs: number, active: boolean) => void;
  readonly syncWorldLocalPlayerPresentation: (showWorld: boolean, spectator: boolean) => void;
  readonly syncWorldPersistentBasePresentation: (showWorld: boolean, spectator: boolean) => void;
  readonly requestWorldStaticShadowBake: (force: boolean) => void;
  readonly syncWorldStaticShadowProfile: (force: boolean) => void;
  readonly syncWorldShadows: (shadowArenaActive: boolean, inRoundWorld: boolean) => void;
  readonly syncWorldLighting: (inArena: boolean, inRoundWorld: boolean) => void;
}

export interface ArenaRuntimeDiagnosticsPort {
  readonly getChunkRenderingDiagnosticsState: (
    staticShadows: boolean,
    shadowSamplingMode: ChunkSamplingMode | null,
  ) => ChunkRenderingDiagnosticsState;
  readonly setGroundSurfaceVisible: (visible: boolean) => void;
  readonly setRockOverlayVisible: (visible: boolean) => void;
  readonly setChunkSampling: (mode: ChunkSamplingMode) => void;
  readonly setRockRenderer: (mode: RockRendererMode) => void;
  readonly setRockGpuPageSize: (size: RockGpuPageSize) => void;
  readonly getFlowFieldDebugPort: (type: ArenaInputDebugHotkey) => EnemyFlowFieldDebugPort | null;
  readonly getFlowFieldDiagnosticsPort: () => ArenaDiagnosticsFlowFieldPort | null;
  readonly getRockVisualDiagnostics: () => ArenaDiagnosticsRockVisualSystemPort | null;
}

export interface ArenaRuntimeRpcPorts {
  readonly worldParticipation: WorldParticipationRpcPort;
  readonly playerCapabilities: PlayerCapabilitiesRpcPort;
  readonly construction: ConstructionRpcPort;
  readonly persistentBase: PersistentBaseRpcPort;
  readonly playerLoadout: PlayerLoadoutRpcPort;
  readonly heldAction: HeldActionRpcPort;
  readonly train: TrainRpcPort;
}

export interface ArenaRuntimeStrategicTargetsPort {
  readonly getHostSnapshot: (now: number) => readonly SyncedAk47StrategicTarget[];
  readonly getEnemyVisual: (enemyId: string) => EnemyVisualSource | null;
}

export type ArenaRuntimePersistentBasePort = ArenaInputPersistentBasePorts;
export type ArenaRuntimePlacementPort = ArenaInputPlacementPorts;
