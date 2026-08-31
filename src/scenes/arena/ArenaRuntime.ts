import type Phaser from 'phaser';
import type { ArenaContext } from './ArenaContext';
import type { RendererBundle } from './RendererBundle';
import type { RockVisualHelper } from './RockVisualHelper';
import type { PlacementPreviewRenderer } from './PlacementPreviewRenderer';
import type { PersistentBasePreviewRenderer } from './PersistentBasePreviewRenderer';
import type { HostUpdateCoordinator } from './HostUpdateCoordinator';
import type { ClientUpdateCoordinator } from './ClientUpdateCoordinator';
import type { LobbyOverlay } from '../LobbyOverlay';
import type { RoomQualityMonitor } from '../../network/RoomQualityMonitor';
import type { CoopMissionOutcome } from '../../activity/CoopMissionRuntime';
import { ArenaLifecycleCoordinator } from './ArenaLifecycleCoordinator';
import { ArenaPersistentBaseSession } from './ArenaPersistentBaseSession';

/**
 * Scene-langlebiger Top-Level-Owner des Arena-Layers.
 *
 * Er besitzt die wenigen wirklich uebergeordneten Owner - den Arena-Flow und den raumlanglebigen
 * Persistent-Base-Owner - und die Frame-Orchestrierung der Arena. Er ist ausdruecklich **kein**
 * Dependency-Container: Er wird nicht an Systeme weitergereicht, haelt keinen Gameplay-State und
 * kennt von einer laufenden Activity nur deren benannte Frame-Schritte.
 *
 * Die fachliche Reihenfolge innerhalb eines Schrittes gehoert weiterhin ihrem Owner: Der Host-
 * Frame fuehrt seine Phasen selbst aus, und welche Systeme in `hostSimulationStep` laufen, weiss
 * allein die `CoopMissionRuntime`.
 */
export interface ArenaRuntimeInput {
  readonly scene: Phaser.Scene;
  readonly ctx: ArenaContext;
  readonly renderers: RendererBundle;
  readonly rockVisualHelper: RockVisualHelper;
  readonly placementPreview: PlacementPreviewRenderer;
  readonly persistentBasePreviewRenderer: PersistentBasePreviewRenderer;
  readonly lobbyOverlay: LobbyOverlay;
  readonly hostUpdate: HostUpdateCoordinator;
  readonly clientUpdate: ClientUpdateCoordinator;
  readonly roomQualityMonitor: RoomQualityMonitor;
}

export class ArenaRuntime {
  /** Raumlanglebiger Persistent-Base-Owner; er ueberlebt jede World und jede Runde. */
  readonly persistentBase: ArenaPersistentBaseSession;
  /** Der Arena-Flow: World-/Activity-Uebergaenge, Readiness, Participation, Completion. */
  readonly flow: ArenaLifecycleCoordinator;

  private readonly hostUpdate: HostUpdateCoordinator;
  private readonly clientUpdate: ClientUpdateCoordinator;

  constructor(input: ArenaRuntimeInput) {
    this.hostUpdate = input.hostUpdate;
    this.clientUpdate = input.clientUpdate;
    // Der Persistent-Base-Owner entsteht vor dem Flow und fragt ihn erst zur Laufzeit nach der
    // aktuellen World; dadurch bleibt seine Lifetime unabhaengig von jeder World-Instanz.
    this.persistentBase = new ArenaPersistentBaseSession({
      scene: input.scene,
      ctx: input.ctx,
      rockVisualHelper: input.rockVisualHelper,
      world: {
        getWorldBinding: () => this.flow.persistentBaseWorldPorts.getWorldBinding(),
        getConstructionRuntime: () => this.flow.persistentBaseWorldPorts.getConstructionRuntime(),
        getPlayerCapabilities: (playerId) => (
          this.flow.persistentBaseWorldPorts.getPlayerCapabilities(playerId)
        ),
        hasPersistentBaseSite: () => this.flow.persistentBaseWorldPorts.hasPersistentBaseSite(),
        getConfiguredGameMode: () => this.flow.persistentBaseWorldPorts.getConfiguredGameMode(),
      },
    });
    this.flow = new ArenaLifecycleCoordinator(
      input.scene,
      input.ctx,
      input.renderers,
      input.rockVisualHelper,
      input.placementPreview,
      input.persistentBasePreviewRenderer,
      input.lobbyOverlay,
      input.hostUpdate,
      input.clientUpdate,
      input.roomQualityMonitor,
      this.persistentBase,
    );
    // Die Frame-Phasen bekommen den benannten Activity-Schritt vom Frame-Owner - nicht die Scene
    // und nicht ein Missionssystem.
    this.hostUpdate.setActivityStepResolver(() => this.flow.getActivityStep());
    this.clientUpdate.setActivityStepResolver(() => this.flow.getActivityStep());
  }

  /**
   * Der world-scoped Anteil dieses Frames.
   *
   * Update folgt Ownership: Der Top-Level-Owner taktet die laufende World-Runtime, und diese
   * taktet ausschliesslich ihre eigenen Child-Owner.
   */
  update(deltaMs: number): void {
    this.flow.updateWorldRuntime(deltaMs);
  }

  /** Die autoritative Host-Frame-Phase dieser World. */
  runHostFrame(deltaMs: number): void {
    this.hostUpdate.runHostUpdate(deltaMs);
  }

  /** Die darstellende Client-Frame-Phase dieser World. */
  runClientFrame(deltaMs: number): void {
    this.clientUpdate.runClientUpdate(deltaMs);
  }

  /**
   * Benannter Activity-Schritt: Hat die laufende Activity ihren Abschluss erreicht?
   *
   * Der Frame-Owner kennt nur diese Frage. Wie sie beantwortet wird - Ziele, Gegner, Fortschritt -
   * gehoert der Activity-Runtime.
   */
  resolveActivityCompletion(): CoopMissionOutcome | null {
    return this.flow.getActivityStep()?.hostResolveCompletion() ?? null;
  }

  /** Debug-Eingriff auf die laufende Activity; ohne Activity passiert nichts. */
  applyDebugBaseDamage(amount: number): void {
    this.flow.getActivityStep()?.hostApplyDebugBaseDamage(amount);
  }
}
