import type Phaser from 'phaser';
import { bridge } from '../../network/bridge';
import {
  composeWorldGeometry,
  composeWorldSupportGameplay,
  composeWorldTrain,
} from './ArenaWorldEnvironmentComposition';
import { composeWorldPlayerGameplay } from './ArenaWorldPlayerComposition';
import { composeWorldCombatGameplay } from './ArenaWorldCombatComposition';
import {
  composeWorldConstruction,
  composeWorldPowerUp,
} from './ArenaWorldConstructionComposition';
import type { ArenaContext } from './ArenaContext';
import type { RendererBundle } from './RendererBundle';
import type { RockVisualHelper } from './RockVisualHelper';
import type { HostUpdateCoordinator } from './HostUpdateCoordinator';
import type { ArenaLayout, GameMode, SyncedPlaceableRock } from '../../types';
import type { ArenaBuilderResult } from '../../arena/ArenaBuilder';
import type { BaseSpec } from '../../arena/BaseRegistry';
import type { BaseManager } from '../../entities/BaseManager';
import type { PlacementSystem } from '../../systems/PlacementSystem';
import type { CoopMissionRuntime } from '../../activity/CoopMissionRuntime';
import type { CoopMissionPlayerRuntime } from '../../activity/CoopMissionPlayerRuntime';
import type { ActivityDescriptor } from '../../world/ActivityDescriptor';
import type { WorldRuntime } from '../../world/WorldRuntime';
import type { WorldRuntimeContext } from '../../world/WorldRuntimeContext';
import type { PersistentBaseWorldBinding } from '../../world/PersistentBaseWorldBinding';
import { WorldGeometryBinding } from '../../world/WorldGeometryBinding';
import { WorldTargetingRuntime } from '../../world/WorldTargetingRuntime';
import { WorldTrainRuntime } from '../../world/WorldTrainRuntime';
import { WorldPlayerGameplayRuntime } from '../../world/WorldPlayerGameplayRuntime';
import { WorldCombatGameplayBinding } from '../../world/WorldCombatGameplayBinding';
import { WorldSupportGameplayRuntime } from '../../world/WorldSupportGameplayRuntime';
import { WorldPowerUpRuntime } from '../../world/WorldPowerUpRuntime';
import { ConstructionWorldRuntime, type ConstructionPersistentBaseContext } from '../../world/ConstructionWorldRuntime';
import type { PersistentBaseContributionStore } from '../../persistentBase/PersistentBaseContributionStore';
import type { PersistentBaseRewardStore } from '../../persistentBase/PersistentBaseRewardStore';
import type { PlayerCapabilities } from '../../world/PlayerCapabilities';
import type { WorldParticipation } from '../../world/WorldParticipation';

/**
 * Konkrete Composition-Grenze der World-Gameplay-Owner einer Instanz.
 *
 * Sie erzeugt und verdrahtet Geometrie-, Targeting-, Train-, Player-, Combat-, PowerUp-,
 * Construction- und Support-Owner und bindet sie an die `WorldRuntime`, die ihr Lifetime-Owner
 * bleibt. Die Grenze haelt selbst keinen langlebigen Zustand und wird nicht als Dependency
 * weitergereicht; der Flow fragt sie genau einmal pro World-Aufbau.
 *
 * Sie liegt bewusst im Scene-/Adapter-Layer: Hier duerfen `ArenaContext` und `bridge` als konkrete
 * Infrastrukturgrenze vorkommen, waehrend die erzeugten World-Owner selbst beides nicht kennen.
 */

/** Die Fragen der World-Composition an Flow und laufende Activity. */
export interface ArenaWorldGameplayFlowPorts {
  readonly getCoopMissionRuntime: () => CoopMissionRuntime | null;
  readonly getCaptureTheBeerSystem: () => import('../../systems/CaptureTheBeerSystem').CaptureTheBeerSystem | null;
  readonly getPlayerActivityRuntime: () => CoopMissionPlayerRuntime | null;
  readonly isCoopMissionActivity: () => boolean;
  readonly isActivityActive: () => boolean;
  readonly getActivityStartAnchor: () => number | null;
  readonly getPlayerCapabilities: (playerId: string) => PlayerCapabilities;
  readonly getWorldParticipation: (playerId: string) => WorldParticipation;
  readonly getConfiguredGameMode: () => GameMode;
  readonly getWorldMapId: () => string | null;
  readonly onDiagnosticEvent: (type: string, fields?: Record<string, unknown>) => void;
  /** Benannter Activity-Schritt: die Activity materialisiert ihren eigenen Kern. */
  readonly materializeActivityCore: (
    activity: ActivityDescriptor | null,
    runtime: CoopMissionRuntime,
    layout: ArenaLayout,
  ) => void;
  /** Benannter Activity-Schritt: linked Pedestals der laufenden Activity. */
  readonly bindActivityPowerUpPedestals: (
    activity: ActivityDescriptor,
    runtime: CoopMissionRuntime,
    activityStartTime?: number,
  ) => void;
  readonly syncActivityXpReference: () => void;
  readonly syncHostPlayerModifiers: () => void;
  readonly resolveOwnerId: (playerId: string) => string;
  readonly resolvePlayerIdForOwner: (ownerId: string) => string | null;
  readonly acceptsCurrentPersistentBaseMutation: (activityRevision?: number) => boolean;
  readonly mayManagePersistentBase: (playerId: string) => boolean;
  readonly getPersistentBaseConstructionContext: () => ConstructionPersistentBaseContext | null;
  readonly reconcilePersistentBaseWorld: () => void;
  readonly publishImmediatePersistentBaseContribution: (ownerId: string) => void;
  readonly persistCommittedPersistentBaseRewards: () => void;
  readonly publishPersistentBaseRewardSessionState: () => void;
  readonly relocatePlaceableRuntimePresentation: (
    previous: SyncedPlaceableRock,
    next: SyncedPlaceableRock,
  ) => void;
  readonly emitPersistentRestoreAdded: (runtime: SyncedPlaceableRock) => void;
}

/** Die raumlanglebigen Persistent-Base-Stores der laufenden Session. */
export interface ArenaWorldPersistentBaseStores {
  readonly contributions: PersistentBaseContributionStore;
  readonly rewards: PersistentBaseRewardStore;
}

export interface ArenaWorldGameplayCompositionInput {
  readonly scene: Phaser.Scene;
  readonly ctx: ArenaContext;
  readonly renderers: RendererBundle;
  readonly rockVisualHelper: RockVisualHelper;
  readonly hostUpdate: HostUpdateCoordinator;
  readonly flow: ArenaWorldGameplayFlowPorts;
  readonly persistentBaseStores: ArenaWorldPersistentBaseStores;
  readonly worldRuntime: WorldRuntime;
  readonly world: WorldRuntimeContext;
  readonly layout: ArenaLayout;
  readonly layoutMode: GameMode;
  readonly arenaResult: ArenaBuilderResult;
  readonly placementSystem: PlacementSystem;
  readonly baseManager: BaseManager | null;
  readonly worldBases: readonly BaseSpec[];
  readonly persistentBaseBinding: PersistentBaseWorldBinding;
  readonly presentation: boolean;
  readonly isCoopMission: boolean;
  readonly coopMissionRuntime: CoopMissionRuntime | null;
  readonly activityDescriptor: ActivityDescriptor | null;
}

/**
 * Die World-Gameplay-Owner genau einer World-Instanz.
 *
 * Sie leben und sterben mit ihrer `WorldRuntime`; die Slots werden nur von den `onDestroy`-Hooks
 * der Owner selbst geleert.
 */
export class ArenaWorldGameplay {
  geometry: WorldGeometryBinding | null = null;
  targeting: WorldTargetingRuntime | null = null;
  train: WorldTrainRuntime | null = null;
  player: WorldPlayerGameplayRuntime | null = null;
  combat: WorldCombatGameplayBinding | null = null;
  powerUp: WorldPowerUpRuntime | null = null;
  construction: ConstructionWorldRuntime | null = null;
  support: WorldSupportGameplayRuntime | null = null;
}

/**
 * Erzeugt und bindet den World-Gameplay-Graphen dieser Instanz an ihre `WorldRuntime`.
 *
 * Die Reihenfolge ist fachlich: Geometrie und Zielfelder stehen vor der Activity, die Activity
 * materialisiert ihren eigenen Kern, danach folgen Zug, Player-, Kampf- und Bau-Anteil. Der Flow
 * ruft nur diese eine Grenze; die konkreten Owner entstehen in den fokussierten Composern.
 */
export function composeArenaWorldGameplay(
  input: ArenaWorldGameplayCompositionInput,
): ArenaWorldGameplay {
  const { flow, isCoopMission, coopMissionRuntime, activityDescriptor, layout } = input;
  const gameplay = new ArenaWorldGameplay();

  composeWorldGeometry(input, gameplay);
  if (coopMissionRuntime && isCoopMission) {
    // Benannter Activity-Schritt: welche Systeme darin entstehen, gehoert der Activity.
    flow.materializeActivityCore(activityDescriptor, coopMissionRuntime, layout);
  }
  composeWorldTrain(input, gameplay);
  if (bridge.isHost()) composeWorldPlayerGameplay(input, gameplay);
  composeWorldCombatGameplay(input, gameplay);
  if (!coopMissionRuntime) {
    bridge.publishCoopDefenseRespawnBudgetState(null);
    // Ohne Mission gibt es keinen Fortschritt zu zeigen; ein stehengebliebener Stand waere das
    // Bild der letzten Runde.
    bridge.publishCoopDefenseMissionProgressPresentationState(null);
  }
  if (bridge.isHost()) {
    composeWorldPowerUp(input, gameplay);
    composeWorldConstruction(input, gameplay);
    composeWorldSupportGameplay(input, gameplay);
  }
  return gameplay;
}
