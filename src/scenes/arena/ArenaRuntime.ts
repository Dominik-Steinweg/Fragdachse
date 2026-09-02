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
import type { ArenaSpectatorCameraInput } from './ArenaInputBindings';
import { resetWorldCameraBase } from '../../world/WorldPresentationFrameBinding';
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
  /**
   * A/D- bzw. Pfeiltasten-Eingabe der freien Zuschauerkamera. Lazy, weil die Input-Bindings der
   * Scene erst nach der `ArenaRuntime` entstehen – wie bei `rockVisualHelper`s World-Ports.
   */
  readonly getSpectatorCameraInput: () => ArenaSpectatorCameraInput | undefined;
}

export class ArenaRuntime {
  /** Raumlanglebiger Persistent-Base-Owner; er ueberlebt jede World und jede Runde. */
  readonly persistentBase: ArenaPersistentBaseSession;
  /** Der Arena-Flow: World-/Activity-Uebergaenge, Readiness, Participation, Completion. */
  readonly flow: ArenaLifecycleCoordinator;

  private readonly scene: Phaser.Scene;
  private readonly hostUpdate: HostUpdateCoordinator;
  private readonly clientUpdate: ClientUpdateCoordinator;

  constructor(input: ArenaRuntimeInput) {
    this.scene = input.scene;
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
        getWorldRuntime: () => this.flow.getWorldRuntime(),
        getPlayerGameplayRuntime: () => this.flow.getWorldPlayerGameplayRuntime(),
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
      input.getSpectatorCameraInput,
    );
    this.hostUpdate.setWorldFramePort({
      getWorldRuntime: () => this.flow.getWorldRuntime(),
      getTrainRuntime: () => this.flow.getWorldTrainRuntime(),
    });
    this.hostUpdate.setPlayerFramePort({
      getPlayerGameplayRuntime: () => this.flow.getWorldPlayerGameplayRuntime(),
      getPowerUpRuntime: () => this.flow.getWorldPowerUpRuntime(),
    });
    this.hostUpdate.setCombatFramePort({
      getTargetingRuntime: () => this.flow.getWorldTargetingRuntime(),
      getCombatGameplayBinding: () => this.flow.getWorldCombatGameplayBinding(),
      getSupportGameplayRuntime: () => this.flow.getWorldSupportGameplayRuntime(),
    });
    this.hostUpdate.setActivityFramePort({
      getStep: () => this.flow.getActivityStep(),
      getCoopMissionRuntime: () => this.flow.getCoopMissionRuntime(),
      getCaptureTheBeerRuntime: () => this.flow.getCaptureTheBeerActivityRuntime(),
    });
    this.clientUpdate.setWorldFramePort({
      getWorldRuntime: () => this.flow.getWorldRuntime(),
      getTargetingRuntime: () => this.flow.getWorldTargetingRuntime(),
    });
    this.clientUpdate.setPlayerFramePort({
      getPlayerGameplayRuntime: () => this.flow.getWorldPlayerGameplayRuntime(),
      getPowerUpRuntime: () => this.flow.getWorldPowerUpRuntime(),
    });
    this.clientUpdate.setActivityFramePort({
      getStep: () => this.flow.getActivityStep(),
      getCoopMissionRuntime: () => this.flow.getCoopMissionRuntime(),
    });
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

  /**
   * Positioniert die Weltkamera dieser World fuer diesen Frame; wird pro Frame zweimal gerufen -
   * einmal vor der Simulation, einmal danach auf die finale Spielerposition.
   */
  syncWorldCamera(deltaMs: number, showWorld: boolean): void {
    const presentationFrame = this.flow.getWorldRuntime()?.presentationFrame;
    // Ohne aktive World-Presentation - zwischen zwei Instanzen oder vor der ersten - gilt
    // derselbe neutrale Stand wie fuer eine World ohne Weltkamera. Sonst bliebe die Basis der
    // vorherigen World stehen, und das Kamera-Feedback rechnete am Frame-Ende darauf weiter.
    if (!presentationFrame) {
      resetWorldCameraBase(this.scene);
      return;
    }
    presentationFrame.syncCamera(deltaMs, showWorld);
  }

  /** Gleicht die residenten Render-Chunks dieser World an den sichtbaren Ausschnitt an. */
  syncWorldSurfaceResidency(showWorld: boolean): void {
    this.flow.getWorldRuntime()?.presentationFrame?.syncSurfaceResidency(showWorld);
  }

  /**
   * Der raumlanglebige Anteil dieses Frames.
   *
   * Er haengt am Raum und nicht an World, Activity oder Rundenphase: Jeder Peer bietet seinen
   * persoenlichen Basisbeitrag an und uebernimmt, was der Host ihm bestaetigt hat. Welche
   * raumlanglebigen Owner das betrifft, entscheidet dieser Top-Level-Owner - nicht die Scene.
   */
  syncRoomOwners(): void {
    this.persistentBase.syncPersistentBaseContributions();
    this.persistentBase.syncPersistentBaseRewards();
  }

  /**
   * Die autoritative Host-Frame-Phase dieser World; liefert den Abschluss der laufenden Activity.
   *
   * Der Frame-Owner fuehrt die Host-Phase aus und fragt danach genau einen benannten
   * Activity-Schritt. Die *Anwendung* des Abschlusses bleibt bewusst beim Aufrufer: Sie beendet
   * die World-Instanz, und die letzte Momentaufnahme dieser Runde muss davor entstehen.
   */
  runHostFrame(deltaMs: number, gameplayActive = false): CoopMissionOutcome | null {
    this.hostUpdate.runHostUpdate(deltaMs);
    if (!gameplayActive) return null;
    return this.flow.getActivityStep()?.hostResolveCompletion() ?? null;
  }

  /** Die darstellende Client-Frame-Phase dieser World. */
  runClientFrame(deltaMs: number): void {
    this.clientUpdate.runClientUpdate(deltaMs);
  }

  /** Debug-Eingriff auf die laufende Activity; ohne Activity passiert nichts. */
  applyDebugBaseDamage(amount: number): void {
    this.flow.getActivityStep()?.hostApplyDebugBaseDamage(amount);
  }
}
